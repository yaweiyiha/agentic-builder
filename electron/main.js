const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");

const isDev = process.env.NODE_ENV !== "production";

// ── Parallel-instance support ────────────────────────────────────────────
// Two parallel codegen projects launch two Electron instances. Each one
// reads:
//   BUILDER_DEV_URL          — Next.js dev server URL (default :3000)
//   BUILDER_INSTANCE_LABEL   — short tag prefixed in the window title
// Pair this with `--user-data-dir=...` (passed on the electron CLI) to
// keep cookies / localStorage / cache fully partitioned between the two
// instances. See `scripts/start-parallel-dev.sh --electron` for the
// canonical invocation.
const DEV_URL = (process.env.BUILDER_DEV_URL ?? "http://localhost:3000").trim();
const INSTANCE_LABEL = (process.env.BUILDER_INSTANCE_LABEL ?? "").trim();

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: "#ffffff",
    titleBarStyle: "hiddenInset",
    title: INSTANCE_LABEL
      ? `Agentic Builder · ${INSTANCE_LABEL}`
      : "Agentic Builder",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    mainWindow.loadURL(DEV_URL);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, "../out/index.html"));
  }

  return mainWindow;
}

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

ipcMain.handle("get-platform", () => process.platform);
ipcMain.handle("get-app-version", () => app.getVersion());
