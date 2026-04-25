import { Button, Select, SelectItem, Switch, Tab, Tabs } from '@heroui/react'
import BasePage from '@renderer/components/base/base-page'
import SettingCard from '@renderer/components/base/base-setting-card'
import SettingItem from '@renderer/components/base/base-setting-item'
import PermissionModal from '@renderer/components/mihomo/permission-modal'
import ServiceModal from '@renderer/components/mihomo/service-modal'
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
  deleteElevateTask,
  initService,
  installService,
  startService,
  restartService,
  stopService,
  uninstallService
} from '@renderer/utils/ipc'
import React, { useState } from 'react'
import ControllerSetting from '@renderer/components/mihomo/controller-setting'
import EnvSetting from '@renderer/components/mihomo/env-setting'
import AdvancedSetting from '@renderer/components/mihomo/advanced-settings'
import LogSetting from '@renderer/components/mihomo/log-setting'

const Mihomo: React.FC = () => {
  const { appConfig, patchAppConfig } = useAppConfig()
  const {
    core = 'mihomo',
    corePermissionMode = 'elevated',
    mihomoCpuPriority = 'PRIORITY_NORMAL'
  } = appConfig || {}
  const { controledMihomoConfig, patchControledMihomoConfig } = useControledMihomoConfig()
  const { ipv6 } = controledMihomoConfig || {}

  const [upgrading, setUpgrading] = useState(false)
  const [showPermissionModal, setShowPermissionModal] = useState(false)
  const [showServiceModal, setShowServiceModal] = useState(false)

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

  const handlePermissionModeChange = async (mode: 'elevated' | 'service'): Promise<void> => {
    await patchAppConfig({ corePermissionMode: mode })
    await restartCore()
    PubSub.publish('mihomo-core-changed')
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
      {showServiceModal && (
        <ServiceModal
          onChange={setShowServiceModal}
          onInstall={installService}
          onInit={initService}
          onStart={startService}
          onRestart={restartService}
          onStop={stopService}
          onUninstall={async () => {
            await uninstallService()
            if (corePermissionMode === 'service') {
              await patchAppConfig({ corePermissionMode: 'elevated' })
              await restartCore()
              PubSub.publish('mihomo-core-changed')
            }
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
        <SettingItem title="内核进程优先级" divider>
          <Select
            classNames={{ trigger: 'data-[hover=true]:bg-default-200' }}
            className="w-37.5"
            size="sm"
            selectedKeys={new Set([mihomoCpuPriority])}
            disallowEmptySelection={true}
            onSelectionChange={async (v) => {
              try {
                await patchAppConfig({
                  mihomoCpuPriority: v.currentKey as Priority
                })
                await restartCore()
                PubSub.publish('mihomo-core-changed')
              } catch (e) {
                alert(e)
              }
            }}
          >
            <SelectItem key="PRIORITY_HIGHEST">实时</SelectItem>
            <SelectItem key="PRIORITY_HIGH">高</SelectItem>
            <SelectItem key="PRIORITY_ABOVE_NORMAL">高于正常</SelectItem>
            <SelectItem key="PRIORITY_NORMAL">正常</SelectItem>
            <SelectItem key="PRIORITY_BELOW_NORMAL">低于正常</SelectItem>
            <SelectItem key="PRIORITY_LOW">低</SelectItem>
          </Select>
        </SettingItem>
        <SettingItem title="运行模式" divider>
          <Tabs
            size="sm"
            color="primary"
            selectedKey={corePermissionMode}
            classNames={{
              cursor: 'bg-primary',
              tabContent: 'group-data-[selected=true]:text-primary-foreground'
            }}
            onSelectionChange={(key) => handlePermissionModeChange(key as 'elevated' | 'service')}
          >
            <Tab key="elevated" title="直接运行" />
            <Tab key="service" title="系统服务" />
          </Tabs>
        </SettingItem>
        <SettingItem title="提权状态" divider>
          <Button size="sm" color="primary" onPress={() => setShowPermissionModal(true)}>
            管理
          </Button>
        </SettingItem>
        <SettingItem title="服务状态" divider>
          <Button size="sm" color="primary" onPress={() => setShowServiceModal(true)}>
            管理
          </Button>
        </SettingItem>
        <SettingItem title="IPv6">
          <Switch
            size="sm"
            isSelected={ipv6}
            onValueChange={(v) => onChangeNeedRestart({ ipv6: v })}
          />
        </SettingItem>
      </SettingCard>
      <LogSetting />
      <PortSetting />
      <ControllerSetting />
      <EnvSetting />
      <AdvancedSetting />
    </BasePage>
  )
}

export default Mihomo
