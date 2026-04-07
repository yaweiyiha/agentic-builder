export interface ElectronAPI {
  getPlatform: () => Promise<string>;
  getAppVersion: () => Promise<string>;
  isElectron: boolean;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
