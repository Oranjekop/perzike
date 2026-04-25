import React, { useState } from 'react'
import SettingCard from '../base/base-setting-card'
import SettingItem from '../base/base-setting-item'
import { Button } from '@heroui/react'
import { listLocalBackups, localBackup } from '@renderer/utils/ipc'
import LocalRestoreModal from './local-restore-modal'

const LocalBackupConfig: React.FC = () => {
  const [backuping, setBackuping] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [backupDir, setBackupDir] = useState('')
  const [filenames, setFilenames] = useState<string[]>([])
  const [restoreOpen, setRestoreOpen] = useState(false)

  const showNotification = (title: string, body: string): void => {
    new window.Notification(title, { body })
  }

  const handleBackup = async (): Promise<void> => {
    setBackuping(true)
    try {
      const savedPath = await localBackup()
      showNotification('备份成功', `本地备份已保存到：${savedPath}`)
    } catch (e) {
      if (e !== '用户取消操作') {
        showNotification('备份失败', `${e}`)
      }
    } finally {
      setBackuping(false)
    }
  }

  const handleRestore = async (): Promise<void> => {
    try {
      setRestoring(true)
      const { backupDir, files } = await listLocalBackups()
      setBackupDir(backupDir)
      setFilenames(files)
      if (files.length === 0) {
        showNotification('没有备份', '所选目录中没有可恢复的备份文件')
      } else {
        setRestoreOpen(true)
      }
    } catch (e) {
      if (e !== '用户取消操作') {
        showNotification('读取失败', `${e}`)
      }
    } finally {
      setRestoring(false)
    }
  }

  return (
    <>
      {restoreOpen && (
        <LocalRestoreModal
          backupDir={backupDir}
          filenames={filenames}
          onClose={() => setRestoreOpen(false)}
        />
      )}
      <SettingCard title="本地备份">
        <SettingItem title="导出 / 恢复配置">
          <div className="text-sm text-default-500 w-[60%] text-right">
            可将当前配置导出为 zip，也可从本地备份恢复
          </div>
        </SettingItem>
        <div className="flex justify-between">
          <Button
            isLoading={backuping}
            fullWidth
            size="sm"
            color="primary"
            variant="flat"
            className="mr-1"
            onPress={handleBackup}
          >
            备份
          </Button>
          <Button
            isLoading={restoring}
            fullWidth
            size="sm"
            color="primary"
            variant="flat"
            className="ml-1"
            onPress={handleRestore}
          >
            恢复
          </Button>
        </div>
      </SettingCard>
    </>
  )
}

export default LocalBackupConfig
