import { z } from "zod/v4";
import { SafeDurableObjectBuilder } from "../src/index";
import { DurableObject } from "cloudflare:workers";

type State = {
  count: number;
  lastMessage: string;
};

type Env = {
  MY_DURABLE_OBJECT: DurableObjectNamespace<MyDurableObject>;
};

export class MyDurableObject extends SafeDurableObjectBuilder(
  class extends DurableObject<Env> {
    state: State;
    constructor(public ctx: DurableObjectState, public env: Env) {
      super(ctx, env);
      this.state = {
        count: 0,
        lastMessage: "",
      };
    }
    setState(state: State) {
      this.state = state;
    }
  },
  (fn) => ({
    hello: fn
      .input(z.string())
      .output(z.object({ message: z.string(), id: z.string() }))
      .meta({ description: "Say hello to the server" })
      .implement(function ({ ctx, input }) {
        const state = this.state;
        this.setState({
          count: state.count + 1,
          lastMessage: input,
        });
        return {
          message: `Hello, ${input}!! state: ${JSON.stringify(state)}`,
          id: ctx.id.toString(),
        };
      }),
    ping: fn.output(z.object({ message: z.string() })).implement(function ({}) {
      return {
        message: "pong",
      };
    }),
  })
) {}

export default {
  async fetch(request, env, ctx) {
    const stub = env.MY_DURABLE_OBJECT.get(
      env.MY_DURABLE_OBJECT.idFromName("test")
    );
    const hello = await stub.hello("world");
    const ping = await stub.ping();
    return Response.json({ hello, ping });
  },
} as ExportedHandler<Env>;
