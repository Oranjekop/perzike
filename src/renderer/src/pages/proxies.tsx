import { Avatar, Button, Card, CardBody, Chip } from '@heroui/react'
import BasePage from '@renderer/components/base/base-page'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import {
  getImageDataURL,
  mihomoChangeProxy,
  mihomoCloseConnections,
  mihomoProxyDelay
} from '@renderer/utils/ipc'
import { FaLocationCrosshairs } from 'react-icons/fa6'
import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import ProxyItem from '@renderer/components/proxies/proxy-item'
import ProxySettingModal from '@renderer/components/proxies/proxy-setting-modal'
import { IoIosArrowBack } from 'react-icons/io'
import { MdDoubleArrow, MdOutlineSpeed, MdTune } from 'react-icons/md'
import { useGroups } from '@renderer/hooks/use-groups'
import CollapseInput from '@renderer/components/base/collapse-input'
import { includesIgnoreCase } from '@renderer/utils/includes'
import { useControledMihomoConfig } from '@renderer/hooks/use-controled-mihomo-config'

const EMPTY_GROUPS: ControllerMixedGroup[] = []
type GroupBooleanState = Record<string, boolean>
type GroupStringState = Record<string, string>
type GroupElementRefs = Record<string, HTMLDivElement | null>

const Proxies: React.FC = () => {
  const { controledMihomoConfig } = useControledMihomoConfig()
  const { mode = 'rule' } = controledMihomoConfig || {}
  const { groups: rawGroups, mutate } = useGroups()
  const groups = rawGroups ?? EMPTY_GROUPS
  const { appConfig } = useAppConfig()
  const {
    proxyDisplayLayout = 'double',
    groupDisplayLayout = 'double',
    proxyDisplayOrder = 'default',
    autoCloseConnection = true,
    closeMode = 'all',
    showGlobalByMode = false,
    proxyCols = 'auto',
    delayTestUrlScope = 'group',
    delayTestConcurrency = 50
  } = appConfig || {}
  const visibleGroups = useMemo(() => {
    if (!showGlobalByMode) return groups
    if (mode === 'global') return groups.filter((group) => group.name === 'GLOBAL')
    if (mode === 'rule') return groups.filter((group) => group.name !== 'GLOBAL')
    return groups
  }, [groups, mode, showGlobalByMode])
  const [cols, setCols] = useState(1)
  const [isOpen, setIsOpen] = useState<GroupBooleanState>({})
  const [delaying, setDelaying] = useState<GroupBooleanState>({})
  const [searchValue, setSearchValue] = useState<GroupStringState>({})
  const [isSettingModalOpen, setIsSettingModalOpen] = useState(false)
  const groupRefs = useRef<GroupElementRefs>({})
  const selectedProxyRefs = useRef<GroupElementRefs>({})
  const allProxies = useMemo(() => {
    const proxiesByGroup: (ControllerProxiesDetail | ControllerGroupDetail)[][] = []
    visibleGroups.forEach((group) => {
      const groupName = group.name
      if (isOpen[groupName]) {
        let groupProxies = group.all.filter(
          (proxy) => proxy && includesIgnoreCase(proxy.name, searchValue[groupName] || '')
        )
        if (proxyDisplayOrder === 'delay') {
          groupProxies = groupProxies.sort((a, b) => {
            if (a.history.length === 0) return -1
            if (b.history.length === 0) return 1
            if (a.history[a.history.length - 1].delay === 0) return 1
            if (b.history[b.history.length - 1].delay === 0) return -1
            return a.history[a.history.length - 1].delay - b.history[b.history.length - 1].delay
          })
        }
        if (proxyDisplayOrder === 'name') {
          groupProxies = groupProxies.sort((a, b) => a.name.localeCompare(b.name))
        }
        proxiesByGroup.push(groupProxies)
      } else {
        proxiesByGroup.push([])
      }
    })
    return proxiesByGroup
  }, [visibleGroups, isOpen, proxyDisplayOrder, cols, searchValue])

  const onChangeProxy = useCallback(
    async (group: string, proxy: string): Promise<void> => {
      await mihomoChangeProxy(group, proxy)
      if (autoCloseConnection) {
        if (closeMode === 'all') {
          await mihomoCloseConnections()
        } else if (closeMode === 'group') {
          await mihomoCloseConnections(group)
        }
      }
      mutate()
    },
    [autoCloseConnection, closeMode, mutate]
  )

  const getDelayTestUrl = useCallback(
    (group?: ControllerMixedGroup): string | undefined => {
      if (delayTestUrlScope === 'global') return undefined
      return group?.testUrl
    },
    [delayTestUrlScope]
  )

  const onProxyDelay = useCallback(
    async (proxy: string, group?: ControllerMixedGroup): Promise<ControllerProxiesDelay> => {
      return await mihomoProxyDelay(proxy, getDelayTestUrl(group))
    },
    [getDelayTestUrl]
  )

  const onGroupDelay = useCallback(
    async (index: number): Promise<void> => {
      const groupName = visibleGroups[index]?.name
      if (!groupName) return
      if (allProxies[index].length === 0) {
        setIsOpen((prev) => {
          return { ...prev, [groupName]: true }
        })
      }
      setDelaying((prev) => {
        return { ...prev, [groupName]: true }
      })
      const result: Promise<void>[] = []
      const runningList: Promise<void>[] = []
      for (const proxy of allProxies[index]) {
        const promise = Promise.resolve().then(async () => {
          try {
            await mihomoProxyDelay(proxy.name, getDelayTestUrl(visibleGroups[index]))
          } catch {
            // ignore
          } finally {
            mutate()
          }
        })
        result.push(promise)
        const running = promise.then(() => {
          runningList.splice(runningList.indexOf(running), 1)
        })
        runningList.push(running)
        if (runningList.length >= (delayTestConcurrency || 50)) {
          await Promise.race(runningList)
        }
      }
      await Promise.all(result)
      setDelaying((prev) => {
        return { ...prev, [groupName]: false }
      })
    },
    [allProxies, visibleGroups, delayTestConcurrency, mutate, getDelayTestUrl]
  )

  const calcCols = useCallback((): number => {
    if (window.matchMedia('(min-width: 1536px)').matches) {
      return 5
    } else if (window.matchMedia('(min-width: 1280px)').matches) {
      return 4
    } else if (window.matchMedia('(min-width: 1024px)').matches) {
      return 3
    } else {
      return 2
    }
  }, [])

  const toggleOpen = useCallback((groupName: string) => {
    setIsOpen((prev) => {
      return { ...prev, [groupName]: !prev[groupName] }
    })
  }, [])

  const updateSearchValue = useCallback((groupName: string, value: string) => {
    setSearchValue((prev) => {
      return { ...prev, [groupName]: value }
    })
  }, [])

  const scrollToCurrentProxy = useCallback(
    (index: number) => {
      const groupName = visibleGroups[index]?.name
      if (!groupName) return
      if (!isOpen[groupName]) {
        setIsOpen((prev) => {
          return { ...prev, [groupName]: true }
        })
        requestAnimationFrame(() => {
          selectedProxyRefs.current[groupName]?.scrollIntoView({
            behavior: 'smooth',
            block: 'nearest'
          })
          groupRefs.current[groupName]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        })
        return
      }
      selectedProxyRefs.current[groupName]?.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest'
      })
      groupRefs.current[groupName]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    },
    [isOpen, visibleGroups]
  )

  useEffect(() => {
    if (proxyCols !== 'auto') {
      setCols(parseInt(proxyCols))
      return
    }
    setCols(calcCols())
    const handleResize = (): void => {
      setCols(calcCols())
    }
    window.addEventListener('resize', handleResize)
    return (): void => {
      window.removeEventListener('resize', handleResize)
    }
  }, [proxyCols, calcCols])

  useEffect(() => {
    let cancelled = false

    visibleGroups.forEach((group) => {
      if (!group.icon || !group.icon.startsWith('http') || localStorage.getItem(group.icon)) return
      getImageDataURL(group.icon).then((dataURL) => {
        if (cancelled) return
        localStorage.setItem(group.icon!, dataURL)
        mutate()
      })
    })

    return (): void => {
      cancelled = true
    }
  }, [visibleGroups, mutate])

  const groupContent = useCallback(
    (index: number) => {
      return visibleGroups[index] ? (
        <div
          ref={(el) => {
            groupRefs.current[visibleGroups[index].name] = el
          }}
          className={`w-full pt-2 ${index === visibleGroups.length - 1 && !isOpen[visibleGroups[index].name] ? 'pb-2' : ''} px-2`}
        >
          <Card as="div" isPressable fullWidth onPress={() => toggleOpen(visibleGroups[index].name)}>
            <CardBody className="w-full h-14">
              <div className="flex justify-between h-full">
                <div className="flex items-center text-ellipsis overflow-hidden whitespace-nowrap h-full">
                  {visibleGroups[index].icon ? (
                    <Avatar
                      className="bg-transparent mr-2 w-6 h-6 min-w-6 self-center"
                      classNames={{ img: 'object-contain' }}
                      radius="sm"
                      src={
                        visibleGroups[index].icon.startsWith('<svg')
                          ? `data:image/svg+xml;utf8,${visibleGroups[index].icon}`
                          : localStorage.getItem(visibleGroups[index].icon) ||
                            visibleGroups[index].icon
                      }
                    />
                  ) : null}
                  <div
                    className={`flex flex-col h-full ${groupDisplayLayout === 'double' ? '' : 'justify-center'}`}
                  >
                    <div
                      className={`text-ellipsis overflow-hidden whitespace-nowrap leading-tight ${groupDisplayLayout === 'double' ? 'text-md flex-5 flex items-center' : 'text-lg'}`}
                    >
                      <span className="flag-emoji inline-block">{visibleGroups[index].name}</span>
                      {groupDisplayLayout === 'single' && (
                        <>
                          <div
                            title={visibleGroups[index].type}
                            className="inline ml-2 text-sm text-foreground-500"
                          >
                            {visibleGroups[index].type}
                          </div>
                          <div className="inline flag-emoji ml-2 text-sm text-foreground-500">
                            {visibleGroups[index].now}
                          </div>
                        </>
                      )}
                    </div>
                    {groupDisplayLayout === 'double' && (
                      <div className="text-ellipsis whitespace-nowrap text-[10px] text-foreground-500 leading-tight flex-3 flex items-center">
                        <span>{visibleGroups[index].type}</span>
                        <span className="flag-emoji ml-1 inline-block">
                          {visibleGroups[index].now}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center">
                  <div className="flex items-center" onClick={(e) => e.stopPropagation()}>
                    <Chip size="sm" className="my-1 mr-2">
                      {visibleGroups[index].all.length}
                    </Chip>
                    <CollapseInput
                      title="搜索节点"
                      value={searchValue[visibleGroups[index].name] || ''}
                      onValueChange={(v) => updateSearchValue(visibleGroups[index].name, v)}
                    />
                    <Button
                      title="定位到当前节点"
                      variant="light"
                      size="sm"
                      isIconOnly
                      onPress={() => scrollToCurrentProxy(index)}
                    >
                      <FaLocationCrosshairs className="text-lg text-foreground-500" />
                    </Button>
                    <Button
                      title="延迟测试"
                      variant="light"
                      isLoading={!!delaying[visibleGroups[index].name]}
                      size="sm"
                      isIconOnly
                      onPress={() => onGroupDelay(index)}
                    >
                      <MdOutlineSpeed className="text-lg text-foreground-500" />
                    </Button>
                  </div>
                  <IoIosArrowBack
                    className={`transition duration-200 ml-2 h-8 text-lg text-foreground-500 flex items-center ${isOpen[visibleGroups[index].name] ? '-rotate-90' : ''}`}
                  />
                </div>
              </div>
            </CardBody>
          </Card>
        </div>
      ) : (
        <div>Never See This</div>
      )
    },
    [
      visibleGroups,
      isOpen,
      groupDisplayLayout,
      searchValue,
      delaying,
      toggleOpen,
      updateSearchValue,
      scrollToCurrentProxy,
      onGroupDelay,
    ]
  )

  const itemContent = useCallback(
    (groupIndex: number) => {
      return allProxies[groupIndex] ? (
        <div
          style={
            proxyCols !== 'auto'
              ? { gridTemplateColumns: `repeat(${proxyCols}, minmax(0, 1fr))` }
              : {}
          }
          className={`grid ${proxyCols === 'auto' ? 'sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5' : ''} ${groupIndex === visibleGroups.length - 1 ? 'pb-2' : ''} gap-2 pt-2 mx-2`}
        >
          {allProxies[groupIndex].map((proxy) => {
            const isSelected = proxy?.name === visibleGroups[groupIndex].now
            return (
              <div
                key={proxy.name}
                ref={(el) => {
                  if (isSelected) {
                    selectedProxyRefs.current[visibleGroups[groupIndex].name] = el
                  }
                }}
              >
                <ProxyItem
                  mutateProxies={mutate}
                  onProxyDelay={onProxyDelay}
                  onSelect={onChangeProxy}
                  proxy={proxy}
                  group={visibleGroups[groupIndex]}
                  proxyDisplayLayout={proxyDisplayLayout}
                  selected={isSelected}
                />
              </div>
            )
          })}
        </div>
      ) : (
        <div>Never See This</div>
      )
    },
    [
      allProxies,
      proxyCols,
      mutate,
      onProxyDelay,
      onChangeProxy,
      visibleGroups,
      proxyDisplayLayout
    ]
  )

  return (
    <BasePage
      title="代理组"
      header={
        <Button
          size="sm"
          isIconOnly
          variant="light"
          className="app-nodrag"
          title="代理组设置"
          onPress={() => setIsSettingModalOpen(true)}
        >
          <MdTune className="text-lg" />
        </Button>
      }
    >
      {isSettingModalOpen && <ProxySettingModal onClose={() => setIsSettingModalOpen(false)} />}
      {mode === 'direct' ? (
        <div className="h-full w-full flex justify-center items-center">
          <div className="flex flex-col items-center">
            <MdDoubleArrow className="text-foreground-500 text-[100px]" />
            <h2 className="text-foreground-500 text-[20px]">直连模式</h2>
          </div>
        </div>
      ) : (
        <div className="h-[calc(100vh-50px)]">
          <div className="h-full overflow-y-auto">
            {visibleGroups.map((group, index) => (
              <div key={group.name}>
                {groupContent(index)}
                {isOpen[group.name] ? itemContent(index) : null}
              </div>
            ))}
          </div>
        </div>
      )}
    </BasePage>
  )
}

export default Proxies
