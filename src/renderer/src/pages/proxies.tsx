import { Button, Card, CardBody, Chip } from '@heroui/react'
import BasePage from '@renderer/components/base/base-page'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import {
  getImageDataURL,
  mihomoChangeProxy,
  mihomoCloseConnections,
  mihomoProxyDelay
} from '@renderer/utils/ipc'
import { FaLocationCrosshairs } from 'react-icons/fa6'
import { useEffect, useMemo, useRef, useState, useCallback, useLayoutEffect } from 'react'
import {
  Virtuoso,
  VirtuosoHandle
} from 'react-virtuoso'
import ProxyItem from '@renderer/components/proxies/proxy-item'
import ProxySettingModal from '@renderer/components/proxies/proxy-setting-modal'
import { IoIosArrowBack } from 'react-icons/io'
import { MdDoubleArrow, MdOutlineSpeed, MdTune } from 'react-icons/md'
import { useGroups } from '@renderer/hooks/use-groups'
import { useProxiesState } from '@renderer/hooks/use-proxies-state'
import CollapseInput from '@renderer/components/base/collapse-input'
import { includesIgnoreCase } from '@renderer/utils/includes'
import { useControledMihomoConfig } from '@renderer/hooks/use-controled-mihomo-config'

const calcAutoProxyCols = (): number => {
  if (window.matchMedia('(min-width: 1536px)').matches) {
    return 5
  } else if (window.matchMedia('(min-width: 1280px)').matches) {
    return 4
  } else if (window.matchMedia('(min-width: 1024px)').matches) {
    return 3
  } else {
    return 2
  }
}

type ProxyListRow =
  | {
      type: 'group'
      groupIndex: number
    }
  | {
      type: 'proxies'
      groupIndex: number
      rowIndex: number
    }

const Proxies: React.FC = () => {
  const { controledMihomoConfig } = useControledMihomoConfig()
  const { mode = 'rule' } = controledMihomoConfig || {}
  const { groups = [], mutate } = useGroups()
  const { isOpenMap, searchValueMap, setIsOpen, setSearchValue, syncGroups } = useProxiesState()
  const { appConfig } = useAppConfig()
  const {
    proxyDisplayLayout = 'double',
    groupDisplayLayout = 'double',
    proxyDisplayOrder = 'default',
    autoCloseConnection = true,
    closeMode = 'all',
    proxyCols = 'auto',
    showGlobalByMode = false,
    delayTestUrlScope = 'group',
    delayTestConcurrency = 50
  } = appConfig || {}
  const [cols, setCols] = useState(() =>
    proxyCols !== 'auto' ? parseInt(proxyCols) : calcAutoProxyCols()
  )
  const [delaying, setDelaying] = useState<Map<string, boolean>>(new Map())
  const [isSettingModalOpen, setIsSettingModalOpen] = useState(false)
  const [pendingScrollIndex, setPendingScrollIndex] = useState<number | null>(null)
  const [iconCacheVersion, setIconCacheVersion] = useState(0)
  const virtuosoRef = useRef<VirtuosoHandle>(null)
  const visibleGroups = useMemo(() => {
    if (!showGlobalByMode) return groups
    if (mode === 'global') return groups.filter((group) => group.name === 'GLOBAL')
    if (mode === 'rule') return groups.filter((group) => group.name !== 'GLOBAL')
    return groups
  }, [groups, mode, showGlobalByMode])

  useEffect(() => {
    syncGroups(visibleGroups.map((g) => g.name))
  }, [visibleGroups, syncGroups])
  const { groupCounts, allProxies } = useMemo(() => {
    const counts: number[] = []
    const proxiesByGroup: (ControllerProxiesDetail | ControllerGroupDetail)[][] = []
    visibleGroups.forEach((group) => {
      const isGroupOpen = isOpenMap.get(group.name) ?? false
      const groupSearchValue = searchValueMap.get(group.name) ?? ''
      if (isGroupOpen) {
        let groupProxies = group.all.filter(
          (proxy) => proxy && includesIgnoreCase(proxy.name, groupSearchValue)
        )
        const rowCount = Math.ceil(groupProxies.length / cols)
        counts.push(rowCount)
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
        counts.push(0)
        proxiesByGroup.push([])
      }
    })
    return { groupCounts: counts, allProxies: proxiesByGroup }
  }, [visibleGroups, isOpenMap, searchValueMap, proxyDisplayOrder, cols])
  const rows = useMemo<ProxyListRow[]>(() => {
    return visibleGroups.flatMap((_, groupIndex) => {
      const groupRows: ProxyListRow[] = [{ type: 'group', groupIndex }]
      for (let rowIndex = 0; rowIndex < groupCounts[groupIndex]; rowIndex++) {
        groupRows.push({ type: 'proxies', groupIndex, rowIndex })
      }
      return groupRows
    })
  }, [visibleGroups, groupCounts])

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
      const group = visibleGroups[index]
      if (!group) return
      if (allProxies[index].length === 0) {
        setIsOpen(group.name, true)
      }
      setDelaying((prev) => {
        const next = new Map(prev)
        next.set(group.name, true)
        return next
      })
      const result: Promise<void>[] = []
      const runningList: Promise<void>[] = []
      for (const proxy of allProxies[index]) {
        const promise = Promise.resolve().then(async () => {
          try {
            await mihomoProxyDelay(proxy.name, getDelayTestUrl(group))
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
        const next = new Map(prev)
        next.set(group.name, false)
        return next
      })
    },
    [allProxies, visibleGroups, delayTestConcurrency, mutate, getDelayTestUrl, setIsOpen]
  )

  const toggleOpen = useCallback(
    (index: number) => {
      const group = visibleGroups[index]
      if (!group) return
      setIsOpen(group.name, !(isOpenMap.get(group.name) ?? false))
    },
    [visibleGroups, isOpenMap, setIsOpen]
  )

  const updateSearchValue = useCallback(
    (index: number, value: string) => {
      const group = visibleGroups[index]
      if (!group) return
      setSearchValue(group.name, value)
    },
    [visibleGroups, setSearchValue]
  )

  const scrollToCurrentProxy = useCallback(
    (targetIndex: number) => {
      const group = visibleGroups[targetIndex]
      if (!group) return

      let rowIndex = 0
      for (let i = 0; i < targetIndex; i++) {
        rowIndex += 1 + groupCounts[i]
      }
      const currentProxyIndex = allProxies[targetIndex].findIndex((proxy) => proxy.name === group.now)
      rowIndex += 1 + Math.max(0, Math.floor(currentProxyIndex / cols))
      virtuosoRef.current?.scrollToIndex({
        index: rowIndex,
        align: 'start'
      })
    },
    [visibleGroups, groupCounts, allProxies, cols]
  )

  const handleLocateCurrentProxy = useCallback(
    (index: number) => {
      const group = visibleGroups[index]
      if (!group) return
      if (!(isOpenMap.get(group.name) ?? false)) {
        setPendingScrollIndex(index)
        setIsOpen(group.name, true)
        return
      }
      scrollToCurrentProxy(index)
    },
    [visibleGroups, isOpenMap, setIsOpen, scrollToCurrentProxy]
  )

  useEffect(() => {
    if (pendingScrollIndex === null) {
      return
    }

    const group = visibleGroups[pendingScrollIndex]
    if (!group || !(isOpenMap.get(group.name) ?? false)) {
      return
    }

    requestAnimationFrame(() => {
      scrollToCurrentProxy(pendingScrollIndex)
      setPendingScrollIndex(null)
    })
  }, [pendingScrollIndex, visibleGroups, isOpenMap, scrollToCurrentProxy])

  useLayoutEffect(() => {
    if (proxyCols !== 'auto') {
      setCols(parseInt(proxyCols))
      return
    }
    setCols(calcAutoProxyCols())
    const handleResize = (): void => {
      setCols(calcAutoProxyCols())
    }
    window.addEventListener('resize', handleResize)
    return (): void => {
      window.removeEventListener('resize', handleResize)
    }
  }, [proxyCols])

  useEffect(() => {
    let cancelled = false

    visibleGroups.forEach((group) => {
      if (!group.icon || !group.icon.startsWith('http') || localStorage.getItem(group.icon)) return
      getImageDataURL(group.icon).then((dataURL) => {
        if (cancelled) return
        localStorage.setItem(group.icon!, dataURL)
        setIconCacheVersion((version) => version + 1)
      })
    })

    return (): void => {
      cancelled = true
    }
  }, [visibleGroups])

  const getGroupIconSrc = useCallback(
    (icon: string) => {
      if (icon.startsWith('<svg')) {
        return `data:image/svg+xml;utf8,${icon}`
      }
      return localStorage.getItem(icon) || icon
    },
    [iconCacheVersion]
  )

  const groupContent = useCallback(
    (index: number) => {
      const group = visibleGroups[index]
      const isGroupOpen = group ? (isOpenMap.get(group.name) ?? false) : false
      const groupSearchValue = group ? (searchValueMap.get(group.name) ?? '') : ''
      const isGroupDelaying = group ? (delaying.get(group.name) ?? false) : false
      return group ? (
        <div
          className={`w-full pt-2 ${index === groupCounts.length - 1 && !isGroupOpen ? 'pb-2' : ''} px-2`}
        >
          <Card as="div" isPressable fullWidth onPress={() => toggleOpen(index)} className="proxy-group-card">
            <CardBody className="w-full h-14">
              <div className="flex justify-between h-full">
                <div className="flex items-center text-ellipsis overflow-hidden whitespace-nowrap h-full">
                  {group.icon ? (
                    <img
                      alt=""
                      draggable={false}
                      className="mr-2 h-6 w-6 min-w-6 self-center rounded-small object-contain"
                      src={getGroupIconSrc(group.icon)}
                    />
                  ) : null}
                  <div
                    className={`flex flex-col h-full ${groupDisplayLayout === 'double' ? '' : 'justify-center'}`}
                  >
                    <div
                      className={`text-ellipsis overflow-hidden whitespace-nowrap leading-tight ${groupDisplayLayout === 'double' ? 'text-md flex-5 flex items-center' : 'text-lg'}`}
                    >
                      <span className="flag-emoji inline-block">{group.name}</span>
                      {groupDisplayLayout === 'single' && (
                        <>
                          <div title={group.type} className="inline ml-2 text-sm text-foreground-500">
                            {group.type}
                          </div>
                          <div className="inline flag-emoji ml-2 text-sm text-foreground-500">{group.now}</div>
                        </>
                      )}
                    </div>
                    {groupDisplayLayout === 'double' && (
                      <div className="text-ellipsis whitespace-nowrap text-[10px] text-foreground-500 leading-tight flex-3 flex items-center">
                        <span>{group.type}</span>
                        <span className="flag-emoji ml-1 inline-block">{group.now}</span>
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center">
                  <div className="flex items-center" onClick={(e) => e.stopPropagation()}>
                    <Chip size="sm" className="my-1 mr-2">
                      {group.all.length}
                    </Chip>
                    <CollapseInput
                      title="搜索节点"
                      value={groupSearchValue}
                      onValueChange={(v) => updateSearchValue(index, v)}
                    />
                    <Button
                      title="定位到当前节点"
                      variant="light"
                      size="sm"
                      isIconOnly
                      onPress={() => handleLocateCurrentProxy(index)}
                    >
                      <FaLocationCrosshairs className="text-lg text-foreground-500" />
                    </Button>
                    <Button
                      title="延迟测试"
                      variant="light"
                      isLoading={isGroupDelaying}
                      size="sm"
                      isIconOnly
                      onPress={() => onGroupDelay(index)}
                    >
                      <MdOutlineSpeed className="text-lg text-foreground-500" />
                    </Button>
                  </div>
                  <IoIosArrowBack
                    className={`transition duration-200 ml-2 h-8 text-lg text-foreground-500 flex items-center ${isGroupOpen ? '-rotate-90' : ''}`}
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
      groupCounts,
      isOpenMap,
      searchValueMap,
      groupDisplayLayout,
      delaying,
      getGroupIconSrc,
      toggleOpen,
      updateSearchValue,
      handleLocateCurrentProxy,
      onGroupDelay
    ]
  )

  const rowContent = useCallback(
    (_index: number, row: ProxyListRow) => {
      if (row.type === 'group') {
        return groupContent(row.groupIndex)
      }
      const { groupIndex, rowIndex } = row
      return allProxies[groupIndex] ? (
        <div
          style={
            proxyCols !== 'auto'
              ? { gridTemplateColumns: `repeat(${proxyCols}, minmax(0, 1fr))` }
              : {}
          }
          className={`grid ${proxyCols === 'auto' ? 'sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5' : ''} ${groupIndex === groupCounts.length - 1 && rowIndex === groupCounts[groupIndex] - 1 ? 'pb-2' : ''} gap-2 pt-2 mx-2`}
        >
          {Array.from({ length: cols }).map((_, columnIndex) => {
            const proxy = allProxies[groupIndex][rowIndex * cols + columnIndex]
            if (!proxy) return null
            const isSelected = proxy.name === visibleGroups[groupIndex].now
            return (
              <ProxyItem
                key={proxy.name}
                mutateProxies={mutate}
                onProxyDelay={onProxyDelay}
                onSelect={onChangeProxy}
                proxy={proxy}
                group={visibleGroups[groupIndex]}
                proxyDisplayLayout={proxyDisplayLayout}
                selected={isSelected}
              />
            )
          })}
        </div>
      ) : (
        <div>Never See This</div>
      )
    },
    [
      allProxies,
      groupCounts,
      groupContent,
      proxyCols,
      cols,
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
          <Virtuoso
            ref={virtuosoRef}
            data={rows}
            computeItemKey={(_, row) =>
              row.type === 'group'
                ? `group-${visibleGroups[row.groupIndex]?.name ?? row.groupIndex}`
                : `proxies-${visibleGroups[row.groupIndex]?.name ?? row.groupIndex}-${row.rowIndex}`
            }
            itemContent={rowContent}
          />
        </div>
      )}
    </BasePage>
  )
}

export default Proxies
