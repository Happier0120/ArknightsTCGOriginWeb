# 模块 8.2 · Render 部署指南

## 部署结果

仓库根目录的 `render.yaml` 会创建一个 Node Web Service：

- 单实例运行前端页面和 Socket.IO。
- 使用 Render 注入的 `PORT`。
- 通过 `/health` 检查服务状态。
- 将 `/var/data` 挂载为 1GB 持久磁盘。
- 将房间快照保存到 `/var/data/rooms.json`。
- 将上一代有效备份保存到 `/var/data/rooms.backup.json`。
- 收到平台停机信号时最多保留 30 秒用于保存和退出。

Blueprint 默认采用 `0.5c-512mb` 付费计算方案，因为 Render 免费 Web Service 不支持持久磁盘。配置文件本身不会创建资源；在 Render 控制台确认 Blueprint 后才会创建服务并开始计费。

## 首次部署

当前工程目录尚未初始化为 Git 仓库。准备发布时：

1. 初始化 Git，并把需要发布的源码提交到一个私有或公开的 GitHub/GitLab 仓库。
2. 不要提交 `.env`、`server/data/`、真实房间快照或会话令牌。
3. 在 Render Dashboard 选择 **New > Blueprint**。
4. 连接代码仓库，确认 Render 识别根目录的 `render.yaml`。
5. 查看即将创建的服务、计算规格和磁盘费用，再点击 Apply。
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
4. 刷新其中一个标签页，确认恢复原席位。
5. 在 Render 控制台手动重启服务，确认双方仍能恢复未结束对局。
6. 检查磁盘中已生成 `/var/data/rooms.json`；第二次保存后应同时出现 `/var/data/rooms.backup.json`，并查看服务日志是否有快照恢复记录。

## 免费临时方案

如果只做一次性演示，可以复制 Blueprint 后：

- 将 `plan` 改为 `free`。
- 删除整个 `disk` 配置。
- 将 `ATCG_ROOM_STATE_PATH` 改为 `/tmp/rooms.json`。
- 将 `ATCG_ROOM_BACKUP_PATH` 改为 `/tmp/rooms.backup.json`。

免费实例休眠、重启或重新部署后可能丢失房间；不要用它验证服务重启恢复。

## 当前限制

- 持久磁盘只能由单个服务实例使用，因此不要提高 `numInstances`。
- 当前 JSON 快照适合小规模试玩，不适合高并发或多实例部署。
- 模块 8.2 的部署配置已经接入 8.3 的限流、结构化日志与双快照保护。
- 本项目不会自动登录 Render、创建资源、购买套餐或绑定域名。
- 具体故障演练步骤见 `docs/module-8-public-operations.md`。
