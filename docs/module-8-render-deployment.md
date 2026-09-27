# 模块 8.2 · Render 部署指南

## 部署结果

仓库根目录的 `render.yaml` 会创建一个 Node Web Service：

- 单实例运行前端页面和 Socket.IO。
- 使用 Render 注入的 `PORT`。
- 通过 `/health` 检查服务状态。
- 使用 `free` 免费计算方案，不创建持久磁盘。
- 将运行期房间快照保存到 `/tmp/rooms.json`。
- 将上一代有效备份保存到 `/tmp/rooms.backup.json`。
- 收到平台停机信号时最多保留 30 秒用于保存和退出。

Blueprint 当前采用免费临时测试方案。配置不会申请付费磁盘；只有在 Render 控制台确认 Blueprint 后才会创建服务。免费实例的文件系统不是持久存储，休眠、重启或重新部署后可能丢失进行中的房间。

## 首次部署

当前工程目录尚未初始化为 Git 仓库。准备发布时：

1. 初始化 Git，并把需要发布的源码提交到一个私有或公开的 GitHub/GitLab 仓库。
2. 不要提交 `.env`、`server/data/`、真实房间快照或会话令牌。
3. 在 Render Dashboard 选择 **New > Blueprint**。
4. 连接代码仓库，确认 Render 识别根目录的 `render.yaml`。
5. 确认方案显示为 Free、没有 Disk 资源，再点击 Apply。
6. 等待构建、健康检查和部署完成，打开 Render 提供的 `onrender.com` 地址。

无需手动配置 `PORT`，Render 会自动注入。前端和 Socket.IO 同源，因此无需填写 `ATCG_ALLOWED_ORIGINS`。

## 部署前本地检查

```powershell
npm ci
npm run check
npm run test:e2e
npm run check:deploy
```

`check:deploy` 会检查 Blueprint 与项目生产脚本是否一致，并重新执行生产构建。

## 部署后检查

假设公网地址为 `https://your-service.onrender.com`：

1. 打开 `https://your-service.onrender.com/health`，确认返回 `{"ok":true,"module":"8.3"}`。
2. 打开网站，在两个独立标签页创建和加入房间。
3. 完成准备、秘密调度和至少一次规则操作。
4. 刷新其中一个标签页，确认在当前服务进程内恢复原席位。
5. 查看服务日志，确认存在结构化的 `room_created`、`game_started` 等事件。
6. 不要用免费方案验收服务重启后的对局恢复；实例文件系统重置后，双方应重新创建房间。

## 升级为持久化方案

需要验证跨重启恢复时，先确认平台费用，再修改 Blueprint：

- 将 `plan` 改为支持持久磁盘的实例规格。
- 添加挂载到 `/var/data` 的磁盘。
- 将 `ATCG_ROOM_STATE_PATH` 改为 `/var/data/rooms.json`。
- 将 `ATCG_ROOM_BACKUP_PATH` 改为 `/var/data/rooms.backup.json`。

升级前不要假定具体价格；应以 Render 控制台当时显示的套餐与磁盘费用为准。

## 当前限制

- 当前免费方案不保证保留房间快照，服务重置后玩家需要重新建房。
- 房间状态仍保存在单个服务进程中，因此保持 `numInstances: 1`。
- 当前 JSON 快照适合小规模试玩，不适合高并发或多实例部署。
- 模块 8.2 的部署配置已经接入 8.3 的限流、结构化日志与双快照保护。
- 本项目不会自动登录 Render、创建资源、购买套餐或绑定域名。
- 具体故障演练步骤见 `docs/module-8-public-operations.md`。
