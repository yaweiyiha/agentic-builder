export const NonExistentHelper = {
  getServiceName(): string {
    return process.env.SERVICE_NAME?.trim() || 'pomodoro-api';
  }
};
