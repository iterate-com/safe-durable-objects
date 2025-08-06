import { z } from "zod/v4";
import { makeRpcCapable } from "../src/rpc";
import { DurableObject } from "cloudflare:workers";

type Env = {
  MY_DURABLE_OBJECT: DurableObjectNamespace<MyDurableObject>;
};

const rpc = makeRpcCapable<MyDurableObject>();

type HasDef<T> = T extends { _def: infer U } ? { _def: U } : never;
type HasDefs<T> = { [k in keyof T]: HasDef<T[k]> };

const proxyLogger = new Proxy(console, {
  get(target, prop, receiver) {
    return (...args: any[]) => {
      console.log('proxyLogger', prop, args);
    }
  }
})

type RemoveNeverAndUndefined<T> = {
  [K in keyof T as K extends `__${string}` ? never : [T[K]] extends never ? never : T[K] extends undefined ? never : K]: T[K];
};

const fakeProxy = new Proxy({}, {
  get(target, prop, receiver) {
    console.log('fakeProxy', prop);
    return true;
  },
  getPrototypeOf() {
    console.log('getPrototypeOf');
    return Object.prototype;   // claim we were born here
  }
})

class BaseDurableObject<Env> extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
  }
}

class BoringObject {
  constructor() {
    console.log('BoringObject constructor');
  }
}

const NoOpBase = new Proxy(BaseDurableObject, {
  // traps every `new` or `super()` call
  construct(target, args, newTarget) {
    console.log('construct', target, args, newTarget);
    // allocate a bare instance with the right prototype
    if(!args[0]) {
      return Reflect.construct(BoringObject, args, newTarget);
    }
    return Reflect.construct(BaseDurableObject, args, newTarget);
  },
  get(target, prop, receiver) {
    console.log('get', prop);
    return target[prop as keyof typeof target];
  },
});


// --- 4. Monkey-patch Derived so `super()` hits the proxy --
// Object.setPrototypeOf(MyDurableObjectDerived, NoOpBase);          // [[Prototype]] of the *class* fn
// Object.setPrototypeOf(MyDurableObjectDerived.prototype, DurableObject.prototype); // keep the method chain
export class MyDurableObject extends NoOpBase<Env> {
  async schemas(): Promise<RemoveNeverAndUndefined<{ [k in keyof MyDurableObject]: MyDurableObject[k] extends {_def: { input: any, output: any }} ? { inputSchema: string, outputSchema: string } : never }>>{
    const instance = this;
    const output: ReturnType<typeof instance.schemas> = {} as any;
    for (const key in instance) {
      const value = instance[key as keyof typeof instance];
      if(value && (typeof value === 'object' || typeof value === 'function') && '_def' in value) {
        //@ts-expect-error - this doesn't typecheck nicely but it's fine
        output[key] =  {
          //@ts-expect-error - this doesn't typecheck nicely but it's fine
          inputSchema: value._def.inputSchema,
          //@ts-expect-error - this doesn't typecheck nicely but it's fine
          outputSchema: value._def.outputSchema,
        };
      }
    }
    return Promise.resolve(output);
  }
  static async routes() {
    
    const instance = new MyDurableObject(null as any, null as any);
    return instance.schemas();
  }
  constructor(ctx: DurableObjectState, env: Env) {
    console.log('constructor', ctx, env);
    
    super(ctx, env);
    
   
    rpc.init(this);
  }

  hello = rpc
    .input(z.string())
    .output(z.string())
    .implement(function ({ input }) {
      return `Hello, ${input}!`;
    });

  ping = rpc.output(z.string()).implement(function () {
    return "pong";
  });

  async normalMethod() {
    const hello = await this.hello("world");
    return `Normal method: ${hello}`;
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const name = url.searchParams.get("name");
    if (!name) {
      return Response.json({ error: "name is required" }, { status: 400 });
    }
    const stub = env.MY_DURABLE_OBJECT.get(
      env.MY_DURABLE_OBJECT.idFromName(name)
    );
    const routes = await MyDurableObject.routes();

    const normalMethod = await stub.normalMethod();
    const hello = await stub.hello("world");
    const ping = await stub.ping();

    const defs = await stub.schemas();

    return Response.json({ hello, ping, normalMethod, defs, routes });
  },
} as ExportedHandler<Env>;
