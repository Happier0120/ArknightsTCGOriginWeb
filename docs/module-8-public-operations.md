# 模块 8.3 · 公网运行与故障演练

## 已加入的保护

- Socket.IO 单条消息默认不超过 128 KiB。
- 创建、加入、恢复房间共用来源地址限流，默认每分钟 12 次。
- 准备、开局、离房等控制操作默认每个 Socket 每分钟 120 次。
- 对局指令与认输默认每个 Socket 每分钟 240 次。
- 服务日志为单行 JSON，可按 `event`、`level` 和 `roomCode` 检索。
- 房间数据采用主快照加上一代有效备份；主快照损坏时启动过程自动恢复。

这些数值用于小规模试玩，不是通用生产容量承诺。真实玩家增多后，应根据 Render 指标与限流日志再调整。

## 部署前检查

```powershell
npm ci
npm run check
npm run check:deploy
npm run check:ops
```

`check:ops` 会覆盖限流窗口、敏感字段遮蔽、主备份回退，以及两名真实 Socket.IO 客户端从建房到断线恢复的链路。

## 公网验收

部署完成后按以下顺序验收：

1. 请求 `/health`，应返回 `{"ok":true,"module":"8.3"}`。
2. 使用两台设备或两个独立浏览器窗口创建、加入并开始一局。
3. 各执行一次部署、攻击或回合交接，再刷新其中一端，确认席位和最新 revision 恢复。
4. 在 Render 控制台重启服务，确认未结束房间仍可恢复。
5. 查看日志，应能找到 `server_listening`、`room_created`、`game_started` 和 `room_snapshot_restored` 等 JSON 事件。
6. 检查持久磁盘中存在 `rooms.json`；发生第二次保存后还应存在 `rooms.backup.json`。

日志中不应出现 `sessionToken` 的原值、随机种子、手牌列表或完整 `gameState`。

## 快照故障演练

仅在没有重要试玩对局时进行：

1. 停止服务，先下载 `/var/data/rooms.json` 和 `/var/data/rooms.backup.json` 留档。
2. 确认备份文件存在且不是空文件。
3. 将主文件替换为无效 JSON，保留备份文件不动，然后重新启动服务。
4. 日志中的 `room_snapshot_restored` 应显示 `recoveredFromBackup: true`。
5. 主文件会被自动修复，玩家可使用原浏览器令牌恢复到上一代有效快照。

如果主文件与备份文件都无效，服务会记录 `room_snapshot_load_failed` 并退出，避免静默丢失房间后继续提供服务。此时应恢复人工留档，再重新部署。

## 环境变量

| 变量 | 默认值 | 用途 |
| --- | ---: | --- |
| `ATCG_ROOM_STATE_PATH` | `server/data/rooms.json` | 主快照 |
| `ATCG_ROOM_BACKUP_PATH` | `server/data/rooms.backup.json` | 上一代有效快照 |
| `ATCG_SOCKET_MAX_PAYLOAD_BYTES` | `131072` | 单条 Socket 消息上限 |
| `ATCG_ENTRY_RATE_LIMIT` | `12` | 每分钟入房类请求上限 |
| `ATCG_CONTROL_RATE_LIMIT` | `120` | 每分钟房间控制请求上限 |
| `ATCG_COMMAND_RATE_LIMIT` | `240` | 每分钟对局指令上限 |

## 当前边界

- 限流存储在单进程内，服务重启后计数清空。
- JSON 快照和本地限流适合单实例、小规模试玩；多实例需要共享数据库与集中式限流。
- 备份是上一代快照，不替代定期下载、平台磁盘快照或异地备份。
- 本模块不自动创建 Render 资源，也不修改域名、套餐或账单。
