import { z } from "zod/v4";
import type { DurableObject } from "cloudflare:workers";

export const SafeRpcMethodSymbol = Symbol("SafeRpcMethod");

export type ImplArgs<I extends z.ZodType | undefined, Env> = {
  env: Env;
  ctx: DurableObjectState;
  input: I extends z.ZodType ? z.infer<I> : void;
};

export type SafeRpcHandler<
  I extends z.ZodType | undefined,
  O extends z.ZodType,
  InferredOutput = z.infer<O>,
  Meta = unknown
> = (I extends z.ZodType
  ? {
      (input: z.infer<I>): Promise<InferredOutput>;
    }
  : {
      (): Promise<InferredOutput>;
    }) & {
  _def: {
    input: I extends z.ZodType ? I : z.ZodObject<{}>;
    output: O;
    meta: Meta;
  };
  [SafeRpcMethodSymbol]: true;
};

type MaybePromise<T> = T | Promise<T>;

function createHandler<
  I extends z.ZodType | undefined,
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
  const handler = async function (
    this: T,
    rawInput?: I extends z.ZodType ? z.infer<I> : never
  ) {
    const parsedInput = inputSchema
      ? await inputSchema.parseAsync(rawInput)
      : undefined;

    const result = await fn.call(this, {
      env: this.env,
      ctx: this.ctx,
      input: parsedInput,
    } as ImplArgs<I, Env>);

    return outputSchema ? await outputSchema.parseAsync(result) : result;
  };

  const handlerWithDef = Object.defineProperties(handler, {
    _def: {
      value: {
        // We use z.object({}) as the default input schema as most AI agents expect this incase there is no input
        input: inputSchema ?? z.object({}),
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
    fn: (this: T, args: ImplArgs<I, Env>) => MaybePromise<R>
  ): SafeRpcHandler<I, z.ZodUnknown, R, Meta>;

  implement<OutputType>(
    this: RouteBuilder<Env, T, I, O, Meta>,
    fn: O extends z.ZodType
      ? (this: T, args: ImplArgs<I, Env>) => MaybePromise<z.infer<O>>
      : never
  ): O extends z.ZodType ? SafeRpcHandler<I, O, z.infer<O>, Meta> : never;

  implement(
    fn: (this: T, args: any) => MaybePromise<any>
  ): SafeRpcHandler<any, any, any, Meta> {
    return createHandler(
      fn,
      this.inputSchema as z.ZodType | undefined,
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
        { value, enumerable: true, writable: true, configurable: true },
      ])
    )
  );

  Object.defineProperty(BaseClassWithSafeRpc.prototype, "_def", {
    value: router,
    enumerable: true,
    writable: true,
    configurable: true,
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
