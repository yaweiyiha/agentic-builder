# Task Management Platform

## 1. 项目概览

这是一个任务管理平台项目，采用前后端分离架构：

- `frontend`：基于 `React + TypeScript + Vite + Ant Design React` 的前端应用
- `backend`：基于 `Koa + TypeScript + Sequelize + PostgreSQL` 的后端 API 服务
- `frontend`、`backend` 包管理器均使用 `pnpm`
- `PRD.md`：产品需求文档，描述业务目标、页面与功能边界

---

## 2. 整体架构

### 2.1 架构分层

项目采用典型的前后端分离模式：

1. 前端负责页面渲染、路由切换、登录态维护、调用后端 API。
2. 后端负责认证鉴权、业务处理、数据访问与 API 暴露。
3. 数据层使用 PostgreSQL，后端通过 Sequelize 进行连接与模型管理。

### 2.2 前后端通信方式

- 前端统一通过 `frontend/src/api` 调用后端接口
- 默认请求前缀为 `/api`
- 本地开发时，Vite 通过代理将 `/api` 转发到 `http://localhost:4000`
- 后端统一以 `/api` 作为接口前缀

---

## 3. 根目录结构

```text
tasks/
├── backend/          # 后端服务
├── frontend/         # 前端应用
├── PRD.md            # 产品需求文档
└── README.md         # 项目架构与目录规范说明
```

---

## 4. 前端架构说明

### 4.1 技术栈

- React 19
- TypeScript
- Vite
- React Router

### 4.2 前端目录结构

```text
frontend/
├── public/                 # 静态资源
├── src/
│   ├── api/                # API 请求封装与类型定义
│   ├── assets/             # 图片、图标等资源
│   ├── components/         # 通用 UI 组件
│   ├── constants/          # 常量定义
│   ├── context/            # 全局上下文，如认证状态
│   ├── hooks/              # 自定义 hooks
│   ├── utils/              # 纯工具函数
│   ├── views/              # 页面级视图组件
│   ├── App.css
│   ├── index.css
│   ├── main.tsx            # 前端应用入口
│   └── router.tsx          # 路由配置
├── dist/                   # 构建产物
├── vite.config.ts          # Vite 配置与代理
└── package.json
```

### 4.3 前端目录职责

#### `src/api`

用于统一管理前端对后端 API 的调用，避免请求逻辑散落在页面组件中。
按业务继续拆分，例如 `projects.ts`、`tasks.ts`、`comments.ts`

- `client.ts`：封装通用 `fetch` 请求能力、错误处理、鉴权头注入

#### `src/context`

用于放置全局共享状态，例如承载认证上下文。

#### `src/views`

用于存放页面级组件，而不是通用小组件。当前包括：

- 如果页面复杂度继续提升，可以按页面建立目录，例如：

```text
views/
└── tasks/
    ├── TasksPage.tsx
    ├── TaskDetailPage.tsx
    └── components/
```

#### `src/router.tsx`

统一管理前端路由

#### `src/main.tsx`

作为应用启动入口，负责挂载 React、注入全局样式和顶层 Provider。

### 4.4 前端目录规范

- 页面组件放 `views/`
- API 请求放 `api/`
- 全局状态放 `context/`
- 通用组件后续建议新增 `components/`
- 自定义 hooks 后续建议新增 `hooks/`
- 工具函数后续建议新增 `utils/`
- 样式文件与页面/组件尽量就近放置，减少跨目录查找成本

---

## 5. 后端架构说明

### 5.1 技术栈

- Node.js
- Koa
- TypeScript
- Sequelize
- PostgreSQL
- JWT 鉴权

### 5.2 后端目录结构

```text
backend/
├── src/
│   ├── api/
│   │   └── modules/                # 按业务资源划分的 API 模块
│   │       ├── health/
│   │       └── index.ts            # API 路由统一注册入口
│   ├── config/                     # 环境配置
│   ├── middlewares/                # 中间件
│   ├── models/                     # Sequelize 模型
│   ├── app.ts                      # 应用装配入口
│   ├── db.ts                       # 数据库连接
│   └── server.ts                   # 服务启动入口
├── package.json
└── pnpm-lock.yaml
```

### 5.3 后端分层职责

#### `src/server.js`

仅负责启动服务：

- 初始化数据库连接
- 同步模型
- 启动 HTTP 服务

这个文件应保持轻量，不承载业务逻辑。

#### `src/app.ts`

负责应用级装配：

- 创建 Koa 实例
- 注册错误处理中间件
- 注册请求解析中间件
- 注册 JWT 中间件
- 挂载 API 路由

它是“应用结构入口”，不直接写某个具体业务接口。

#### `src/config`

用于管理环境变量与运行配置，例如：

- `PORT`
- `JWT_SECRET`
- 后续可能增加的数据库、邮件、对象存储、第三方服务配置

#### `src/middlewares`

用于存放通用中间件，而不是具体业务逻辑。

#### `src/api/modules`

这是当前后端最核心的业务目录，采用“按资源拆分”的方式组织 API。

每个模块下通常包含：

- `*.routes.ts`：路由声明，只做 URL 与处理函数映射
- `*.controller.ts`：控制器，处理请求参数、调用模型或服务、返回响应

#### `src/models`

用于放置 Sequelize 模型与模型关联关系。

- 按实体拆分模型定义，例如 `user.model.ts`、`project.model.ts`、`task.model.ts`
- 在 `index.ts` 中统一做导出和关联初始化

#### `src/db.ts`

负责数据库连接初始化，不承载具体业务逻辑。

---

## 6. 编码规范

- !!非常重要!!： 导入类型定义时，必须使用 import type 关键字，不能仅使用 import。
- 优先使用 Tailwind CSS 进行样式开发。

---

## 7. 当前前后端职责边界

### 前端负责

- 页面展示与交互
- 路由控制
- 登录态存储
- 调用 API
- 基础错误提示

### 后端负责

- 认证鉴权
- 业务规则处理
- 数据库操作
- 响应结构输出
- 接口权限控制

---

## 8. 开发与运行

### 8.1 前端

```bash
cd frontend
pnpm install
pnpm dev
```

默认启动后可通过 Vite 本地开发服务访问页面。

### 8.2 后端

```bash
cd backend
pnpm install
pnpm dev
```

默认后端运行在：

```text
http://localhost:4000
```

### 8.3 数据库

当前数据库连接通过环境变量或默认连接串配置，仓库根目录 `.env`

---

## 9. 目录规范总结

可以统一遵循以下规则：

1. 启动入口与业务实现分离。
2. 路由定义与业务处理分离。
3. 通用能力集中放到 `config`、`middlewares`、`utils`。
4. 优先按业务资源拆目录，而不是按技术类型无序堆叠。
5. 页面、接口、状态、模型都要有明确归属，避免“公共目录”无限膨胀。
6. 新增功能时，优先在现有业务模块内扩展，再决定是否抽通用层。

---
