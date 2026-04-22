import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState
} from 'react'
import { useAppConfig } from './use-app-config'
import { useProfileConfig } from './use-profile-config'
import { updateProxyGroupState } from '@renderer/utils/ipc'

interface ProxiesStateContextType {
  isOpenMap: Map<string, boolean>
  searchValueMap: Map<string, string>
  setIsOpen: (groupName: string, value: boolean) => void
  setSearchValue: (groupName: string, value: string) => void
  syncGroups: (groupNames: string[]) => void
}

const ProxiesStateContext = createContext<ProxiesStateContextType | undefined>(undefined)

export const ProxiesStateProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { appConfig } = useAppConfig()
  const { profileConfig } = useProfileConfig()
  const currentProfileId = profileConfig?.current
  const saveTimerRef = useRef<NodeJS.Timeout | undefined>(undefined)
  const isOpenMapRef = useRef<Map<string, boolean>>(new Map())
  const searchValueMapRef = useRef<Map<string, string>>(new Map())
  const isUpdatingFromConfigRef = useRef(false)
  const isInitializedRef = useRef(false)
  const currentProfileIdRef = useRef(currentProfileId)
  const profileConfigRef = useRef(profileConfig)

  const [isOpenMap, setIsOpenMap] = useState<Map<string, boolean>>(new Map())
  const [searchValueMap, setSearchValueMap] = useState<Map<string, string>>(new Map())

  useEffect(() => {
    currentProfileIdRef.current = currentProfileId
  }, [currentProfileId])

  useEffect(() => {
    profileConfigRef.current = profileConfig
  }, [profileConfig])

  useEffect(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = undefined
    }

    isUpdatingFromConfigRef.current = true

    const profileState = currentProfileId
      ? appConfig?.proxyGroupsState?.[currentProfileId]
      : undefined
    const newOpenMap = profileState?.openState
      ? new Map(Object.entries(profileState.openState))
      : new Map()
    const newSearchMap = profileState?.searchState
      ? new Map(Object.entries(profileState.searchState))
      : new Map()

    setIsOpenMap(newOpenMap)
    isOpenMapRef.current = newOpenMap
    setSearchValueMap(newSearchMap)
    searchValueMapRef.current = newSearchMap
    isInitializedRef.current = true

    queueMicrotask(() => {
      isUpdatingFromConfigRef.current = false
    })
  }, [appConfig?.proxyGroupsState, currentProfileId])

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
      }
    }
  }, [])

  const debouncedSave = useCallback(() => {
    if (isUpdatingFromConfigRef.current) {
      return
    }

    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
    }

    saveTimerRef.current = setTimeout(async () => {
      if (isUpdatingFromConfigRef.current) {
        return
      }

      const profileId = currentProfileIdRef.current
      if (!profileId) {
        return
      }

      const profileExists = profileConfigRef.current?.items?.some((item) => item.id === profileId)
      if (!profileExists) {
        return
      }

      try {
        await updateProxyGroupState(profileId, {
          openState: Object.fromEntries(isOpenMapRef.current),
          searchState: Object.fromEntries(searchValueMapRef.current)
        })
      } catch (error) {
        console.warn('[ProxiesState] Failed to save state for profile:', profileId, error)
      }
    }, 500)
  }, [])

  const setIsOpen = useCallback((groupName: string, value: boolean) => {
    setIsOpenMap((prev) => {
      if (prev.get(groupName) === value) return prev
      const next = new Map(prev)
      next.set(groupName, value)
      return next
    })
  }, [])

  const setSearchValue = useCallback((groupName: string, value: string) => {
    setSearchValueMap((prev) => {
      if (prev.get(groupName) === value) return prev
      const next = new Map(prev)
      next.set(groupName, value)
      return next
    })
  }, [])

  const syncGroups = useCallback((groupNames: string[]) => {
    const groupNameSet = new Set(groupNames)

    setIsOpenMap((prev) => {
      let changed = false
      for (const key of prev.keys()) {
        if (!groupNameSet.has(key)) {
          changed = true
          break
        }
      }
      if (!changed) return prev

      const next = new Map(prev)
      for (const key of next.keys()) {
        if (!groupNameSet.has(key)) {
          next.delete(key)
        }
      }
      return next
    })

    setSearchValueMap((prev) => {
      let changed = false
      for (const key of prev.keys()) {
        if (!groupNameSet.has(key)) {
          changed = true
          break
        }
      }
      if (!changed) return prev

      const next = new Map(prev)
      for (const key of next.keys()) {
        if (!groupNameSet.has(key)) {
          next.delete(key)
        }
      }
      return next
    })
  }, [])

  useEffect(() => {
    if (!isInitializedRef.current || isUpdatingFromConfigRef.current) {
      return
    }

    isOpenMapRef.current = isOpenMap
    searchValueMapRef.current = searchValueMap
    debouncedSave()
  }, [isOpenMap, searchValueMap, debouncedSave])

  return (
    <ProxiesStateContext.Provider
      value={{ isOpenMap, searchValueMap, setIsOpen, setSearchValue, syncGroups }}
    >
      {children}
    </ProxiesStateContext.Provider>
  )
}

export const useProxiesState = (): ProxiesStateContextType => {
  const context = useContext(ProxiesStateContext)
  if (context === undefined) {
    throw new Error('useProxiesState must be used within a ProxiesStateProvider')
  }
  return context
}
