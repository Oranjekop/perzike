import { Button, Input, Select, SelectItem, Switch } from '@heroui/react'
import BasePage from '@renderer/components/base/base-page'
import SettingCard from '@renderer/components/base/base-setting-card'
import SettingItem from '@renderer/components/base/base-setting-item'
import PermissionModal from '@renderer/components/mihomo/permission-modal'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import { useControledMihomoConfig } from '@renderer/hooks/use-controled-mihomo-config'
import PortSetting from '@renderer/components/mihomo/port-setting'
import { platform } from '@renderer/utils/init'
import { IoMdCloudDownload } from 'react-icons/io'
import PubSub from 'pubsub-js'
import {
  manualGrantCorePermition,
  mihomoUpgrade,
  restartCore,
  revokeCorePermission,
  deleteElevateTask
} from '@renderer/utils/ipc'
import React, { useState } from 'react'
import ControllerSetting from '@renderer/components/mihomo/controller-setting'
import EnvSetting from '@renderer/components/mihomo/env-setting'
import AdvancedSetting from '@renderer/components/mihomo/advanced-settings'

const Mihomo: React.FC = () => {
  const { appConfig, patchAppConfig } = useAppConfig()
  const { core = 'mihomo', maxLogDays = 7 } = appConfig || {}
  const { controledMihomoConfig, patchControledMihomoConfig } = useControledMihomoConfig()
  const { ipv6, 'log-level': logLevel = 'info' } = controledMihomoConfig || {}

  const [upgrading, setUpgrading] = useState(false)
  const [showPermissionModal, setShowPermissionModal] = useState(false)

  const onChangeNeedRestart = async (patch: Partial<MihomoConfig>): Promise<void> => {
    await patchControledMihomoConfig(patch)
    await restartCore()
  }

  const handleConfigChangeWithRestart = async (key: string, value: unknown): Promise<void> => {
    try {
      await patchAppConfig({ [key]: value })
      await restartCore()
      PubSub.publish('mihomo-core-changed')
    } catch (e) {
      alert(e)
    }
  }

  const handleCoreUpgrade = async (): Promise<void> => {
    try {
      setUpgrading(true)
      await mihomoUpgrade(core === 'mihomo' ? 'release' : 'alpha')
      setTimeout(() => PubSub.publish('mihomo-core-changed'), 2000)
    } catch (e) {
      if (typeof e === 'string' && e.includes('already using latest version')) {
        new Notification('已经是最新版本')
      } else {
        alert(e)
      }
    } finally {
      setUpgrading(false)
    }
  }

  const handleCoreChange = async (newCore: 'mihomo' | 'mihomo-alpha'): Promise<void> => {
    handleConfigChangeWithRestart('core', newCore)
  }

  return (
    <BasePage title="内核设置">
      {showPermissionModal && (
        <PermissionModal
          onChange={setShowPermissionModal}
          onRevoke={async () => {
            if (platform === 'win32') {
              await deleteElevateTask()
              new Notification('任务计划已取消注册')
            } else {
              await revokeCorePermission()
              new Notification('内核权限已撤销')
            }
            await restartCore()
          }}
          onGrant={async () => {
            await manualGrantCorePermition()
            new Notification('内核授权成功')
            await restartCore()
          }}
        />
      )}
      <SettingCard>
        <SettingItem
          title="内核版本"
          actions={
            core === 'mihomo' || core === 'mihomo-alpha' ? (
              <Button
                size="sm"
                isIconOnly
                title="升级内核"
                variant="light"
                isLoading={upgrading}
                onPress={handleCoreUpgrade}
              >
                <IoMdCloudDownload className="text-lg" />
              </Button>
            ) : null
          }
          divider
        >
          <Select
            classNames={{ trigger: 'data-[hover=true]:bg-default-200' }}
            className="w-37.5"
            size="sm"
            selectedKeys={new Set([core])}
            disallowEmptySelection={true}
            onSelectionChange={(v) => handleCoreChange(v.currentKey as 'mihomo' | 'mihomo-alpha')}
          >
            <SelectItem key="mihomo">内置稳定版</SelectItem>
            <SelectItem key="mihomo-alpha">内置预览版</SelectItem>
          </Select>
        </SettingItem>
        <SettingItem title={platform === 'win32' ? '任务状态' : '授权状态'} divider>
          <Button size="sm" color="primary" onPress={() => setShowPermissionModal(true)}>
            管理
          </Button>
        </SettingItem>
        <SettingItem title="IPv6" divider>
          <Switch
            size="sm"
            isSelected={ipv6}
            onValueChange={(v) => onChangeNeedRestart({ ipv6: v })}
          />
        </SettingItem>
        <SettingItem title="日志保留天数" divider>
          <Input
            size="sm"
            type="number"
            className="w-25"
            value={maxLogDays.toString()}
            onValueChange={(v) => patchAppConfig({ maxLogDays: parseInt(v) })}
          />
        </SettingItem>
        <SettingItem title="日志等级">
          <Select
            classNames={{ trigger: 'data-[hover=true]:bg-default-200' }}
            className="w-25"
            size="sm"
            selectedKeys={new Set([logLevel])}
            disallowEmptySelection={true}
            onSelectionChange={(v) =>
              onChangeNeedRestart({ 'log-level': v.currentKey as LogLevel })
            }
          >
            <SelectItem key="silent">静默</SelectItem>
            <SelectItem key="error">错误</SelectItem>
            <SelectItem key="warning">警告</SelectItem>
            <SelectItem key="info">信息</SelectItem>
            <SelectItem key="debug">调试</SelectItem>
          </Select>
        </SettingItem>
      </SettingCard>
      <PortSetting />
      <ControllerSetting />
      <EnvSetting />
      <AdvancedSetting />
    </BasePage>
  )
}

export default Mihomo
