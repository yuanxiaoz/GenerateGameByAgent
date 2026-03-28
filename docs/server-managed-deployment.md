# 服务器内置 API 部署指南

这份指南对应当前仓库里的最小可用方案：

- 前端默认 API 可切换为“服务器内置 API”
- 用户不需要填写自己的 `API Key`
- 浏览器请求走你的后端 `/api/v1/ai-proxy/...`
- 后端从 PostgreSQL 数据库读取 API 配置（地址、密钥、模型、温度、最大 token 数等）
- 通过管理接口 `PUT /api/v1/admin/config` 写入或更新配置，无需重启服务

## 1. 架构说明

请求链路如下：

`浏览器 -> Nginx -> FastAPI(/api/v1/ai-proxy) -> DeepSeek/OpenAI 等上游模型`

注意：

- 如果你只上传了 `dist` 静态网页，没有启动 FastAPI，这个模式不能工作。
- 当前后端实现的是“服务器托管 Key + OpenAI 兼容转发”。
- 项目里的“分步生成”仍然由前端按现有逻辑执行，第 1 步和第 2 步会分别请求后端代理。

## 2. 准备后端环境

在项目根目录执行：

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r server/requirements.txt
cp server/.env.example server/.env
```

然后编辑 `server/.env`：

```env
APP_NAME=XianTu Backend
APP_VERSION=dev
DEBUG=false

# 跨域允许的来源，逗号分隔；同域反代可留空
CORS_ALLOWED_ORIGINS=

# PostgreSQL 连接字符串
DATABASE_URL=postgresql://postgres:password@localhost:5432/xiantu

# AI 请求/响应日志目录，留空禁用
AI_LOG_PATH=
```

说明：

- API 配置（地址、密钥、模型等）不再写在 `.env` 中，改为通过管理接口写入数据库
- 后端启动后会自动建表（`server_api_config`），首次启动后通过接口写入配置即可
- 如使用 SQLite 本地开发，可将 `DATABASE_URL` 改为 `sqlite://server/app.db`

## 3. 启动 FastAPI

开发环境：

```bash
uvicorn server.main:app --host 0.0.0.0 --port 12345 --reload
```

启动后先测试：

```bash
curl http://127.0.0.1:12345/api/v1/version
curl http://127.0.0.1:12345/api/v1/ai-proxy/status
```

如果 `server_managed_ai` / `configured` 为 `true`，说明后端配置已经生效。

## 4. 前端构建

如果你打算由 Nginx 同域名托管前端和后端，前端构建时可以保持默认配置：

```bash
npm install
npm run build
```

如果你的后端是独立域名，可以在构建前指定：

```bash
BACKEND_BASE_URL=https://api.your-domain.com npm run build
```

可选变量：

```bash
DEFAULT_AI_PROXY_PATH=/api/v1/ai-proxy
DEFAULT_FORWARD_MODEL=deepseek-chat
```

## 5. Nginx 反向代理

推荐做法是：

- `dist/` 由 Nginx 提供静态访问
- `/api/` 反向代理到本机 FastAPI

示例配置：

```nginx
server {
    listen 80;
    server_name your-domain.com;

    root /var/www/xiantu/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:12345;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
        proxy_read_timeout 3600s;
    }
}
```

`proxy_buffering off;` 很重要，不然流式输出会被缓存。

## 6. systemd 启动后端

可以创建 `/etc/systemd/system/xiantu-backend.service`：

```ini
[Unit]
Description=XianTu FastAPI Backend
After=network.target

[Service]
WorkingDirectory=/var/www/xiantu
Environment="PYTHONUNBUFFERED=1"
ExecStart=/var/www/xiantu/.venv/bin/uvicorn server.main:app --host 127.0.0.1 --port 12345
Restart=always
RestartSec=3
User=www-data
Group=www-data

[Install]
WantedBy=multi-user.target
```

然后执行：

```bash
sudo systemctl daemon-reload
sudo systemctl enable xiantu-backend
sudo systemctl start xiantu-backend
sudo systemctl status xiantu-backend
```

## 7. 前端如何使用

部署完成后，在前端的 API 管理里：

- 编辑默认 API
- 打开“使用服务器内置 API”
- 用户就不需要填写自己的 Key

如果你保持当前默认配置不改，首次进入时默认 API 就已经是服务器内置模式。

## 8. 生产建议

- 一定要加登录、频率限制和每日额度限制，否则朋友一多很容易把你的 Key 打爆
- 建议把 `/api/v1/ai-proxy/status` 只留给管理员或者内网使用
- 建议用 HTTPS 部署，避免登录态和游戏数据明文传输
- 如果以后要做多用户计费或配额，建议在后端为每个用户记录调用次数和 token 消耗

## 9. 当前最小版限制

- 这版后端主要面向 OpenAI 兼容接口
- 目前没有做用户级配额、账单、审计日志
- 目前没有把“联机模式的权威 AI 调度”迁移到后端，只是把模型密钥托管和请求转发放到后端
