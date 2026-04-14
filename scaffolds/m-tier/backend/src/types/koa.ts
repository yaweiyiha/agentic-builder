import type { DefaultContext, DefaultState, ParameterizedContext } from "koa";

export type AppContext = ParameterizedContext<DefaultState, DefaultContext>;
