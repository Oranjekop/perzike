import React, { createContext, useContext, ReactNode } from 'react'
import useSWR from 'swr'
import { mihomoGroups } from '@renderer/utils/ipc'
import { useAppConfig } from './use-app-config'

interface GroupsContextType {
  groups: ControllerMixedGroup[] | undefined
  mutate: () => void
}

const GroupsContext = createContext<GroupsContextType | undefined>(undefined)

export const GroupsProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { appConfig } = useAppConfig()
  const { showHiddenProxyGroups = false } = appConfig || {}
  const { data: groups, mutate } = useSWR<ControllerMixedGroup[]>(
    ['mihomoGroups', showHiddenProxyGroups],
    () => mihomoGroups(),
    {
      errorRetryInterval: 200,
      errorRetryCount: 10
    }
  )

  React.useEffect(() => {
    const handleGroupsUpdated = (): void => {
      mutate()
    }
    const handleCoreStarted = (): void => {
      mutate()
    }
    const unsubGroupsUpdated = window.electron.ipcRenderer.on('groupsUpdated', handleGroupsUpdated)
    const unsubCoreStarted = window.electron.ipcRenderer.on('core-started', handleCoreStarted)
    return (): void => {
      unsubGroupsUpdated()
      unsubCoreStarted()
    }
  }, [mutate])

  return <GroupsContext.Provider value={{ groups, mutate }}>{children}</GroupsContext.Provider>
}

export const useGroups = (): GroupsContextType => {
  const context = useContext(GroupsContext)
  if (context === undefined) {
    throw new Error('useGroups must be used within an GroupsProvider')
  }
  return context
}
