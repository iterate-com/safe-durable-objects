import { z } from "zod/v4";
import type { DurableObject } from "cloudflare:workers";

export const SafeRpcMethodSymbol = Symbol("SafeRpcMethod");

export type ImplArgs<I extends z.ZodType, Env> = {
  env: Env;
  ctx: DurableObjectState;
  input: z.infer<I>;
};

export type SafeRpcHandler<
  I extends z.ZodType,
  O extends z.ZodType,
  InferredOutput = z.infer<O>
> = {
  (input: z.infer<I>): Promise<InferredOutput>;
  _def: {
    input: I;
    output: O;
  };
  [SafeRpcMethodSymbol]: true;
};

type MaybePromise<T> = T | Promise<T>;

function createHandler<
  I extends z.ZodType,
  O extends z.ZodType,
  Env,
  T extends DurableObject<Env>
>(
  fn: (args: ImplArgs<I, Env>) => MaybePromise<z.infer<O>>,
  inputSchema: I,
  outputSchema?: O
) {
  const handler = async function (this: T, rawInput: z.infer<I>) {
    const parsedInput = await inputSchema.parseAsync(rawInput);
    const result = await fn.call(this, {
      env: this.env,
      ctx: this.ctx,
      input: parsedInput,
    });
    return outputSchema ? await outputSchema.parseAsync(result) : result;
  };

  const handlerWithDef = Object.defineProperties(handler, {
    _def: {
      value: {
        input: inputSchema,
        output: outputSchema ?? z.unknown(),
      },
      enumerable: true,
    },
    [SafeRpcMethodSymbol]: {
      value: true,
      enumerable: true,
    },
  });

  return handlerWithDef;
}

function routeBuilder<Env, T extends DurableObject<Env>>() {
  return {
    input<I extends z.ZodType>(inputSchema: I) {
      return {
        output<O extends z.ZodType>(outputSchema: O) {
          return {
            implement(
              fn: (this: T, args: ImplArgs<I, Env>) => MaybePromise<z.infer<O>>
            ) {
              return createHandler(
                fn,
                inputSchema,
                outputSchema
              ) as SafeRpcHandler<I, O>;
            },
          };
        },
        implement<R>(fn: (this: T, args: ImplArgs<I, Env>) => MaybePromise<R>) {
          return createHandler(fn, inputSchema) as SafeRpcHandler<
            I,
            z.ZodUnknown,
            R
          >;
        },
      };
    },
  };
}

type RouteBuilder<Env, T extends DurableObject<Env>> = ReturnType<
  typeof routeBuilder<Env, T>
>;

type AnyDurableClass<T extends DurableObject, Env> = new (
  ctx: DurableObjectState,
  env: Env
) => T;

export function SafeDurableObjectBuilder<
  Env,
  T extends DurableObject<Env>,
  Router extends Record<string, SafeRpcHandler<any, any>>
>(
  BaseClass: AnyDurableClass<T, Env>,
  routerBuilder: (builder: RouteBuilder<Env, T>) => Router
) {
  // create a extended class so that we don't pollute the base class with the router
  class BaseClassWithSafeRpc extends BaseClass {}

  const router = routerBuilder(routeBuilder());

  Object.defineProperties(
    BaseClassWithSafeRpc.prototype,
    Object.fromEntries(
      Object.entries(router).map(([key, value]) => [
        key,
        { value, enumerable: true },
      ])
    )
  );

  Object.defineProperty(BaseClassWithSafeRpc.prototype, "_def", {
    value: router,
    enumerable: true,
  });

  return BaseClassWithSafeRpc as AnyDurableClass<
    T & Router & { _def: Router },
    Env
  >;
}

export function isSafeDurableObjectMethod(
  method: any
): method is SafeRpcHandler<any, any> {
  return method && method[SafeRpcMethodSymbol] === true;
}
