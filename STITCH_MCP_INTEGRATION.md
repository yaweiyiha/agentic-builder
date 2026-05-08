# Stitch MCP 集成指引

> Google Stitch 是一个 AI 驱动的 UI 设计生成工具，本项目通过直接调用 Stitch MCP HTTP 端点（JSON-RPC）来生成高保真设计稿，无需启动 stitch-mcp 子进程。

---

## 架构概览

```
UI (design.tsx)
  └─ usePipelineStore.runStitchGenerate()
       └─ POST /api/agents/stitch-generate
            └─ src/lib/stitch-api.ts → generateStitchScreen()
                 ├─ callStitchTool("create_project", ...)
                 └─ callStitchTool("generate_screen_from_text", ...)
```

**核心文件：**

| 文件 | 说明 |
|------|------|
| `src/lib/stitch-api.ts` | Stitch MCP HTTP 客户端（认证、JSON-RPC 解析、高层封装） |
| `src/app/api/agents/stitch-generate/route.ts` | Next.js API Route，组装 prompt 并调用 stitch-api |
| `src/store/pipeline-store.ts` | Zustand store，暴露 `runStitchGenerate` action |
| `src/app/(dashboard)/project/[projectId]/_stages/preparation/_sub/design.tsx` | 触发生成、展示结果的 UI 组件 |

---

## 认证配置

Stitch **不支持 API Key**，必须使用 OAuth2 Access Token。认证按以下优先级顺序检查：

---

### 方式 1：Refresh Token 自动换取（✅ 推荐，永不过期）

通过存储 Refresh Token，代码在每次调用时自动换取新的 Access Token，**不会因 1 小时过期而中断**。

#### 第一步：创建 OAuth 2.0 客户端

1. 打开 [GCP Console → API & Services → 凭据](https://console.cloud.google.com/apis/credentials)
2. 点击 **"+ 创建凭据" → "OAuth 客户端 ID"**
3. 应用类型选 **"Web 应用"** 或 **"桌面应用"**
4. 记录生成的 **Client ID** 和 **Client Secret**

#### 第二步：通过 OAuth Playground 获取 Refresh Token

1. 打开 [https://developers.google.com/oauthplayground](https://developers.google.com/oauthplayground)
2. 点击右上角 ⚙️ 齿轮图标 → 勾选 **"Use your own OAuth credentials"**，填入上面的 Client ID 和 Client Secret
3. 左侧搜索并勾选 `https://www.googleapis.com/auth/cloud-platform`，点击 **Authorize APIs**
4. 用有 Stitch 权限的 Google 账号登录授权
5. 点击 **"Exchange authorization code for tokens"**
6. 复制 **`refresh_token`** 的值（注意不是 `access_token`）

#### 第三步：写入 `.env.local`

```env
STITCH_REFRESH_TOKEN=1//xxxx...
STITCH_OAUTH_CLIENT_ID=123456789-abcd.apps.googleusercontent.com
STITCH_OAUTH_CLIENT_SECRET=GOCSPX-xxxx...
GOOGLE_CLOUD_PROJECT=your-gcp-project-id
```

> ✅ Refresh Token **长期有效**（除非手动撤销），无需定期更新。

---

### 方式 2：静态 Access Token（⚠️ 临时使用，约 1 小时过期）

通过 [OAuth Playground](https://developers.google.com/oauthplayground) 直接获取 Access Token：

1. 勾选 scope `https://www.googleapis.com/auth/cloud-platform`
2. 授权后点击 **"Exchange authorization code for tokens"**
3. 复制 `access_token` 值

写入 `.env.local`：

```env
STITCH_ACCESS_TOKEN=ya29.xxxx...
GOOGLE_CLOUD_PROJECT=your-gcp-project-id
```

> ⚠️ 约 **1 小时**后过期，需手动重新获取并更新环境变量，不适合长期使用。

---

### 方式 3：gcloud ADC（开发环境，需安装 gcloud）

```bash
# 安装 gcloud（macOS）
brew install --cask google-cloud-sdk

# 登录并设置 ADC
gcloud auth application-default login
```

登录后无需任何环境变量，代码会自动调用 `gcloud auth application-default print-access-token` 获取 Token（Token 由 gcloud 自动刷新）。

---

### ~~方式 4：STITCH_API_KEY~~（❌ 不支持）

Stitch API 返回：`API keys are not supported by this API. Expected OAuth2 access token`。请勿配置此字段。

---

## GCP 项目要求

### 1. 启用 Stitch API

访问以下链接，点击"启用"：

```
https://console.developers.google.com/apis/api/stitch.googleapis.com/overview?project=<YOUR_PROJECT_ID>
```

### 2. 配置计费项目

```env
GOOGLE_CLOUD_PROJECT=your-gcp-project-id
```

代码会将此值作为 `X-Goog-User-Project` 请求头发送，用于计费归因。

---

## MCP 协议说明

Stitch 使用标准 MCP（Model Context Protocol）JSON-RPC 格式，**响应结构为**：

```json
{
  "id": 123,
  "jsonrpc": "2.0",
  "result": {
    "content": [
      { "type": "text", "text": "{\"name\":\"projects/14362678249946365343\"}" }
    ],
    "isError": false
  }
}
```

> ⚠️ 业务数据包在 `result.content[0].text` 内（JSON 字符串），需要二次 `JSON.parse`，而非直接读取 `result`。

`callStitchTool()` 已正确处理此解析逻辑。

---

## 生成流程

### Step 1：create_project

```typescript
callStitchTool("create_project", { title: "AgenticBuilder Design" })
// 返回: { name: "projects/14362678249946365343" }
```

### Step 2：generate_screen_from_text

```typescript
callStitchTool("generate_screen_from_text", {
  projectId: "14362678249946365343",
  prompt: "...",
  deviceType: "DESKTOP",
  modelId: "GEMINI_3_1_PRO",
})
```

### 生成结果 URL

```
https://stitch.withgoogle.com/projects/<projectId>
```

> ⚠️ 旧 URL `https://labs.google/fx/tools/stitch/<id>` 已废弃，会返回 404。

---

## 常见错误排查

| 错误 | 原因 | 解决方法 |
|------|------|----------|
| `HTTP 401: API keys are not supported` | 使用了 API Key | 改用 OAuth Token，参考认证配置 |
| `HTTP 403: Stitch API has not been used` | GCP 项目未启用 Stitch API | 前往 GCP Console 启用 |
| `Stitch create_project returned no project ID` | MCP 响应解析错误 | 已修复：正确解析 `result.content[0].text` |
| 项目 URL 404 | URL 格式错误 | 已修复：使用 `https://stitch.withgoogle.com/projects/<id>` |
| `Stitch auth not configured` | 无任何认证配置 | 配置 Refresh Token 三件套，或安装 gcloud |
| `Failed to refresh Stitch token` | Refresh Token 换取失败 | 检查 Client ID / Secret 是否正确；确认 Refresh Token 未被撤销 |
| Access Token 1 小时后失效 | 使用了静态 STITCH_ACCESS_TOKEN | 改用 Refresh Token 方式（方式 1），永不过期 |

---

## 本地开发快速启动

### 推荐方式（Refresh Token，永不过期）

```bash
# 1. 在 GCP Console 创建 OAuth 2.0 客户端 ID（Web/桌面应用类型）
# 2. 在 OAuth Playground 用自己的 Client 获取 Refresh Token
# 3. 写入 .env.local
cat >> .env.local << 'EOF'
STITCH_REFRESH_TOKEN=1//xxxx...
STITCH_OAUTH_CLIENT_ID=123456789.apps.googleusercontent.com
STITCH_OAUTH_CLIENT_SECRET=GOCSPX-xxxx
GOOGLE_CLOUD_PROJECT=your-project-id
EOF

# 4. 启动开发服务器
pnpm dev
```

### 备用方式（Access Token，每小时需更新）

```bash
# 在 OAuth Playground 获取 access_token 后
echo "STITCH_ACCESS_TOKEN=ya29.xxxx..." >> .env.local
echo "GOOGLE_CLOUD_PROJECT=your-project-id" >> .env.local
pnpm dev
```
