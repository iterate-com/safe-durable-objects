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
  InferredOutput = z.infer<O>,
  Meta = unknown
> = {
  (input: z.infer<I>): Promise<InferredOutput>;
  _def: {
    input: I;
    output: O;
    meta: Meta;
  };
  [SafeRpcMethodSymbol]: true;
};

type MaybePromise<T> = T | Promise<T>;

function createHandler<
  I extends z.ZodType,
  O extends z.ZodType,
  Env,
  T extends DurableObject<Env>,
  Meta = unknown
>(
  fn: (args: ImplArgs<I, Env>) => MaybePromise<z.infer<O>>,
  inputSchema: I,
  outputSchema?: O,
  meta?: Meta
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
        meta: meta ?? {},
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

class RouteBuilder<
  Env,
  T extends DurableObject<Env>,
  I extends z.ZodType | undefined = undefined,
  O extends z.ZodType | undefined = undefined,
  Meta = unknown
> {
  private inputSchema?: I;
  private outputSchema?: O;
  private metaData?: Meta;

  constructor(inputSchema?: I, outputSchema?: O, metaData?: Meta) {
    this.inputSchema = inputSchema;
    this.outputSchema = outputSchema;
    this.metaData = metaData;
    return this;
  }

  input<InputSchema extends z.ZodType>(
    inputSchema: InputSchema
  ): RouteBuilder<Env, T, InputSchema, O, Meta> {
    if (this.inputSchema) throw new Error("Input schema already set");
    return new RouteBuilder<Env, T, InputSchema, O, Meta>(
      inputSchema,
      this.outputSchema,
      this.metaData
    );
  }

  output<OutputSchema extends z.ZodType>(
    this: RouteBuilder<Env, T, I, undefined, Meta>,
    outputSchema: OutputSchema
  ): RouteBuilder<Env, T, I, OutputSchema, Meta> {
    if (this.outputSchema) throw new Error("Output schema already set");
    return new RouteBuilder<Env, T, I, OutputSchema, Meta>(
      this.inputSchema,
      outputSchema,
      this.metaData
    );
  }

  meta<MetaData>(metaData: MetaData): RouteBuilder<Env, T, I, O, MetaData> {
    if (this.metaData) throw new Error("Metadata already set");
    return new RouteBuilder<Env, T, I, O, MetaData>(
      this.inputSchema,
      this.outputSchema,
      metaData
    );
  }

  implement<R>(
    this: RouteBuilder<Env, T, I, undefined, Meta>,
    fn: I extends z.ZodType
      ? (this: T, args: ImplArgs<I, Env>) => MaybePromise<R>
      : never
  ): I extends z.ZodType ? SafeRpcHandler<I, z.ZodUnknown, R, Meta> : never;

  implement(
    this: RouteBuilder<Env, T, I, O, Meta>,
    fn: I extends z.ZodType
      ? O extends z.ZodType
        ? (this: T, args: ImplArgs<I, Env>) => MaybePromise<z.infer<O>>
        : never
      : never
  ): I extends z.ZodType
    ? O extends z.ZodType
      ? SafeRpcHandler<I, O, z.infer<O>, Meta>
      : never
    : never;

  implement(
    fn: (this: T, args: ImplArgs<any, Env>) => MaybePromise<any>
  ): SafeRpcHandler<any, any, any, Meta> {
    if (!this.inputSchema) throw new Error("Input schema is required");
    return createHandler(
      fn,
      this.inputSchema as z.ZodType,
      this.outputSchema as z.ZodType | undefined,
      this.metaData
    ) as SafeRpcHandler<any, any, any, Meta>;
  }
}
type AnyDurableClass<T extends DurableObject, Env> = new (
  ctx: DurableObjectState,
  env: Env
) => T;

export function SafeDurableObjectBuilder<
  Env,
  T extends DurableObject<Env>,
  Router extends Record<string, SafeRpcHandler<any, any, any, any>>
>(
  BaseClass: AnyDurableClass<T, Env>,
  routerBuilder: (builder: RouteBuilder<Env, T>) => Router
) {
  // create a extended class so that we don't pollute the base class with the router
  class BaseClassWithSafeRpc extends BaseClass {}

  const router = routerBuilder(new RouteBuilder<Env, T>());

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
): method is SafeRpcHandler<any, any, any, any> {
  return method && method[SafeRpcMethodSymbol] === true;
}
