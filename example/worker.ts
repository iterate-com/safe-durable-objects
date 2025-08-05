import { z } from "zod/v4";
import { makeRpcCapable } from "../src/rpc";
import { DurableObject } from "cloudflare:workers";

type Env = {
  MY_DURABLE_OBJECT: DurableObjectNamespace<MyDurableObject>;
};

const rpc = makeRpcCapable<MyDurableObject>();
export class MyDurableObject extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
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
    const normalMethod = await stub.normalMethod();
    const hello = await stub.hello("world");
    const ping = await stub.ping();
    return Response.json({ hello, ping, normalMethod });
  },
} as ExportedHandler<Env>;
