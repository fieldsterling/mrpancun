import { useEffect, useState } from 'react'
import { addStore, getStoreList, setCurrentStore } from '@/lib/store'
import { listProducts, listSnapshotsByDate } from '@/lib/localDb'
import { todayCN } from '@/lib/date'
import { Badge, useToast } from '@/components/ui'

interface Props {
  store?: string
  onStoreSelected: (name: string) => void
  onStoresChanged: () => void
  onGo: (tab: string) => void
}

export default function GuidePage({ store, onStoreSelected, onStoresChanged, onGo }: Props) {
  const { show, node } = useToast()
  const [stores, setStores] = useState<string[]>(getStoreList())
  const [newStore, setNewStore] = useState('')
  const [productCount, setProductCount] = useState<number | null>(null)
  const [snapCount, setSnapCount] = useState<number | null>(null)

  // 检测当前进度：产品是否已导入、今日是否已盘存
  useEffect(() => {
    if (!store) {
      setProductCount(null)
      setSnapCount(null)
      return
    }
    void (async () => {
      const [pl, sl] = await Promise.all([
        listProducts(store),
        listSnapshotsByDate(todayCN(), store),
      ])
      setProductCount(pl.length)
      setSnapCount(sl.length)
    })()
  }, [store])

  const add = () => {
    const name = newStore.trim()
    if (!name) {
      show('请输入门店名称', 'err')
      return
    }
    const list = addStore(name)
    setStores(list)
    setNewStore('')
    setCurrentStore(name)
    onStoreSelected(name)
    onStoresChanged()
    show(`已设置门店：${name}`, 'ok')
  }

  const select = (name: string) => {
    setCurrentStore(name)
    onStoreSelected(name)
    show(`已切换到 ${name}`, 'ok')
  }

  const step1Done = Boolean(store)
  const step2Done = (productCount ?? 0) > 0
  const step3Done = (snapCount ?? 0) > 0

  const step = (done: boolean, current: boolean) =>
    `${current ? 'step step-active' : 'step'} ${done ? 'done' : ''}`

  return (
    <>
      <section className="card">
        <div className="card-title">新手导航 · 三步开始盘存</div>
        <div className="muted mb">
          金店每日盘存系统采用「本地优先」设计：日常操作全部在本地完成，日终一键同步云端备份。
          跟着下面的三步走，几分钟就能开始第一次盘存。
        </div>

        <div className="steps">
          {/* 第 1 步：设置门店 */}
          <div className={step(step1Done, !step1Done)}>
            <div className="step-dot">1</div>
            <div className="step-body">
              <h3>
                设置门店
                {step1Done && <Badge kind="ok">已完成</Badge>}
              </h3>
              <div className="step-desc">
                添加或选择你要盘存的门店，所有数据按门店隔离，互不干扰。
              </div>
              {!step1Done ? (
                <>
                  <div className="row mb">
                    <input
                      className="input"
                      style={{ maxWidth: 240 }}
                      placeholder="新门店名称，如 深圳店"
                      value={newStore}
                      onChange={(e) => setNewStore(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') add()
                      }}
                    />
                    <button className="btn btn-primary" onClick={add}>
                      添加并进入
                    </button>
                  </div>
                  {stores.length > 0 && (
                    <div className="row">
                      <span className="muted">或选择已有门店：</span>
                      {stores.map((s) => (
                        <button key={s} className="nav-btn" onClick={() => select(s)}>
                          {s}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <div className="row">
                  <span className="tag">当前门店：{store}</span>
                  <button className="btn btn-sm" onClick={() => onGo('settings')}>
                    去门店设置
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* 第 2 步：导入产品 */}
          <div className={step(step2Done, step1Done && !step2Done)}>
            <div className="step-dot">2</div>
            <div className="step-body">
              <h3>
                导入产品
                {step2Done && <Badge kind="ok">已完成（{productCount} 项）</Badge>}
              </h3>
              <div className="step-desc">
                用产品信息表（Excel / TXT）批量导入库存，或在「产品管理」手动新增。导入会自动生成入库流水。
              </div>
              <div className="row">
                <button
                  className="btn btn-primary"
                  disabled={!step1Done}
                  onClick={() => onGo('products')}
                >
                  去导入产品
                </button>
                {!step1Done && <span className="muted">请先完成第 1 步</span>}
              </div>
            </div>
          </div>

          {/* 第 3 步：扫码盘存 */}
          <div className={step(step3Done, step1Done && step2Done && !step3Done)}>
            <div className="step-dot">3</div>
            <div className="step-body">
              <h3>
                扫码盘存
                {step3Done && <Badge kind="ok">今日已盘存（{snapCount} 项）</Badge>}
              </h3>
              <div className="step-desc">
                连接扫码枪或导入实盘表，系统实时比对库存差异；确认后写入盘存结果、差异流水并调整库存。
              </div>
              <div className="row">
                <button
                  className="btn btn-primary"
                  disabled={!step1Done || !step2Done}
                  onClick={() => onGo('scan')}
                >
                  去扫码盘存
                </button>
                {(!step1Done || !step2Done) && (
                  <span className="muted">请先完成前面的步骤</span>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-title">更多功能</div>
        <div className="row">
          <button className="btn" onClick={() => onGo('history')}>
            盘存历史
          </button>
          <button className="btn" onClick={() => onGo('journal')}>
            流水明细
          </button>
          <button className="btn" onClick={() => onGo('stats')}>
            库存统计
          </button>
          <button className="btn" onClick={() => onGo('sync')}>
            数据同步
          </button>
        </div>
      </section>

      {node}
    </>
  )
}
