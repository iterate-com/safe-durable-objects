import { isSafeDurableObjectMethod, RouteBuilder, SafeRpcHandler } from ".";
import { DurableObject } from "cloudflare:workers";

type Constructor<T> = new (...args: any[]) => T;
export function makeRpcCapable<T extends DurableObject<any>>() {


  const init = (BaseClass: T) => {
    const router = Object.fromEntries(
      Object.keys(BaseClass)
        .filter((m) => isSafeDurableObjectMethod(BaseClass[m as keyof T]))
        .map((key) => [
          key,
          BaseClass[key as keyof T] as SafeRpcHandler<any, any, any, any>,
        ])
    );

    const prototype = Object.getPrototypeOf(BaseClass);

    for (const rpcMethod of Object.keys(router)) {
      delete BaseClass[rpcMethod as keyof T];
      Object.defineProperty(prototype, rpcMethod, {
        value: router[rpcMethod],
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }

    Object.defineProperty(prototype, "_def", {
      value: router,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  };

  const staticInit = (BaseClazz: Constructor<T>) => {
    const staticInstance = new BaseClazz();
    
    init(staticInstance);
    return staticInstance;
  };
  const rpc = new RouteBuilder();

  Object.defineProperty(rpc, "init", {
    value: init,
    enumerable: true,
    writable: true,
    configurable: true,
  });

  type Env = T extends DurableObject<infer Env> ? Env : never;
  return rpc as RouteBuilder<Env, T> & {
    /**
     * Call this method to initialize the RPC capabilities in constructor.
     */
    init: typeof init;
    staticInit: typeof staticInit;
  };
}
