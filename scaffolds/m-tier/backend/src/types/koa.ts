import type { DefaultContext, DefaultState, ParameterizedContext } from "koa";

export interface AppState extends DefaultState {}

export interface AppContext extends DefaultContext {
  request: DefaultContext["request"] & {
    body?: any;
  };
}

export type AppKoaContext = ParameterizedContext<AppState, AppContext>;
