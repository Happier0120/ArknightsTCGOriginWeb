# 模块 8 · 腾讯云 CloudBase Run 免费试玩部署

## 部署目标

本项目使用根目录 `Dockerfile` 部署到腾讯云 CloudBase Run：

- 一个容器同时提供前端页面、Socket.IO 与 `/health`。
- 容器监听 `PORT`，镜像默认端口为 `8080`。
- 使用单实例，避免内存中的房间状态被分散到多个副本。
- 最小副本数为 0，空闲时允许缩容，控制免费体验资源消耗。
- 房间主备快照写入 `/tmp`，只用于当前实例生命周期内的恢复。
- 标准输出为单行 JSON，直接进入 CloudBase 服务日志。

## 免费环境边界

创建 CloudBase 免费体验版环境时，不开启按量付费。免费资源点耗尽后服务会停服，不会继续按量消耗。

免费方案适合短期玩法测试，但存在以下限制：

- 容器缩容到 0、重启或发布新版本后，`/tmp` 快照可能丢失。
- 默认域名仅用于开发测试，不承诺生产 SLA。
- 使用中国内地自定义域名通常需要完成备案。
- 玩家对局期间保持 WebSocket 连接，可以避免服务因为无请求而立即缩容；所有玩家离开后应视为临时房间。

## 创建环境

1. 登录腾讯云 CloudBase 控制台并完成实名认证。
2. 创建一个免费体验版环境，不开启按量付费。
3. 进入该环境的“云托管”或“CloudBase Run”。
4. 新建服务，服务名填写 `arknights-tcg`。
5. 开启公网访问。

## 代码与构建配置

- 部署来源：GitHub。
- 仓库：`Happier0120/ArknightsTCGOriginWeb`。
- 分支：`main`。
- 构建目录：仓库根目录。
- Dockerfile：`Dockerfile`。
- 监听端口：`8080`。
- 日志采集：标准输出 `stdout`。
- 流量：新版本设置为 100%。

如果 GitHub 拉取或自动触发不稳定，可以将仓库同步到 Gitee，再使用相同 Dockerfile 部署。

## 实例配置

- 副本模式：低成本。
- CPU：选择控制台允许的最低规格。
- 内存：至少 0.5 GB。
- 最小副本数：0。
- 最大副本数：1。
- 自动扩缩容：保持默认，但不要把最大副本数提高到 1 以上。

当前房间状态保存在单进程内。多实例会导致玩家被路由到不同进程，因此本原型必须保持最大副本数为 1。

## 环境变量

容器镜像已提供可用默认值。控制台中建议显式配置：

```text
NODE_ENV=production
PORT=8080
ATCG_ROOM_STATE_PATH=/tmp/rooms.json
ATCG_ROOM_BACKUP_PATH=/tmp/rooms.backup.json
ATCG_ROOM_MAX_AGE_MS=86400000
ATCG_SOCKET_MAX_PAYLOAD_BYTES=131072
ATCG_ENTRY_RATE_LIMIT=12
ATCG_CONTROL_RATE_LIMIT=120
ATCG_COMMAND_RATE_LIMIT=240
```

前后端同域，不需要设置 `ATCG_ALLOWED_ORIGINS`。

## 部署前检查

```powershell
npm ci
npm run check
npm run check:deploy
```

如果本机安装了 Docker，还可以执行：

```powershell
docker build -t arknights-tcg-origin-web .
docker run --rm -p 8080:8080 arknights-tcg-origin-web
```

然后访问 `http://127.0.0.1:8080/health`，应返回：

```json
{"ok":true,"module":"8.3"}
```

## 公网验收

1. 打开 CloudBase 分配的默认域名和 `/health`。
2. 用两个独立浏览器或两台设备创建、加入并开始对局。
3. 完成一次部署、攻击和回合交接。
4. 刷新一端，确认当前实例仍存活时能恢复席位。
5. 查看云托管日志，确认出现 `server_listening`、`room_created` 和 `game_started`。
6. 暂时不要用免费环境验收跨缩容或跨版本恢复；实例重置后重新建房。

## 后续升级

需要长期测试时，应把房间状态迁移到 CloudBase 数据库或其他共享存储，再允许多实例扩缩容。不要把容器 `/tmp` 当作持久数据库。
