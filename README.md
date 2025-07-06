# Safe Durable Objects

**tRPC-style Safe RPC methods for Cloudflare Durable Objects**

[![npm version](https://badge.fury.io/js/safe-durable-objects.svg)](https://badge.fury.io/js/safe-durable-objects)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Safe Durable Objects brings type-safe, validated RPC methods to Cloudflare Durable Objects with a developer experience inspired by tRPC. It uses Zod for runtime validation and provides full TypeScript support.

You can access the router and schemas via `YourClass.prototype._def` or `YourClass.prototype.route._def` as you would with tRPC. This is extremely powerful as you can convert the schemas to a JSON schema and use them to convert your durable object methods into callable tools for your AI agents.

## Features

- 🔒 **Type-safe**: Full TypeScript support with end-to-end type safety
- ✅ **Runtime validation**: Input and output validation using Zod schemas
- 🎯 **tRPC-inspired API**: Familiar developer experience with `.input()`, `.output()`, and `.implement()`

## Installation

```bash
npm install safe-durable-objects zod
# or
pnpm add safe-durable-objects zod
# or
yarn add safe-durable-objects zod
# or
bun add safe-durable-objects zod
```

You'll also need `@cloudflare/workers-types` for TypeScript support:

```bash
npm install -D @cloudflare/workers-types
```

## Quick Start

Here's a complete example of how to use Safe Durable Objects:

```typescript
import { z } from "zod/v4";
import { SafeDurableObjectBuilder } from "safe-durable-objects";
import { DurableObject } from "cloudflare:workers";

type State = {
  count: number;
  lastMessage: string;
};

type Env = {
  MY_DURABLE_OBJECT: DurableObjectNamespace<MyDurableObject>;
};

export class MyDurableObject extends SafeDurableObjectBuilder(
  // This is the base class
  class extends DurableObject<Env> {
    state: State;

    // important: make sure to make the ctx and env public, else you won't be able to access them in the router and typescript will complain
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
      .implement(function ({ ctx, input }) {
        // You can access the base class methods via `this`
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
  })
) {}

export default {
  async fetch(request, env, ctx) {
    const stub = env.MY_DURABLE_OBJECT.get(
      env.MY_DURABLE_OBJECT.idFromName("test")
    );
    const res = await stub.hello("world");
    return Response.json(res);
  },
} as ExportedHandler<Env>;
```

## API Reference

### `SafeDurableObjectBuilder(BaseClass, routerBuilder)`

Creates a new Durable Object class with safe RPC methods.

#### Parameters

- `BaseClass`: Your base Durable Object class
- `routerBuilder`: A function that receives a route builder and returns an object with your RPC methods

#### Route Builder API

The route builder provides a fluent API for defining RPC methods:

```typescript
fn.input(inputSchema).output(outputSchema).implement(handler);
// or
fn.input(inputSchema).implement(handler); // output schema is optional
```

**Note: Only `zod/v4` schemas are supported**

##### `.input(schema)`

Defines the input validation schema using Zod. The input will be validated at runtime.

##### `.output(schema)` (optional)

Defines the output validation schema using Zod. The output will be validated at runtime.

##### `.implement(handler)`

Implements the actual RPC method logic. The handler receives:

- `ctx`: The DurableObjectState
- `env`: The environment bindings
- `input`: The validated input (typed according to your input schema)

**If you use a `function` instead of an arrow function in the implement block, you can access the base class via `this`**

## Examples

### Basic Counter

```typescript
import { z } from "zod/v4";
import { SafeDurableObjectBuilder } from "safe-durable-objects";
import { DurableObject } from "cloudflare:workers";

export class Counter extends SafeDurableObjectBuilder(
  class extends DurableObject<Env> {
    private count = 0;

    // important: make sure to make the ctx and env public, else you won't be able to access them in the router and typescript will complain
    constructor(public ctx: DurableObjectState, public env: Env) {
      super(ctx, env);
    }

    async getCount() {
      return this.count;
    }

    async setCount(value: number) {
      this.count = value;
    }
  },
  (fn) => ({
    increment: fn
      .input(z.object({ by: z.number().optional().default(1) }))
      .output(z.object({ count: z.number() }))
      .implement(async function ({ input }) {
        const currentCount = await this.getCount();
        const newCount = currentCount + input.by;
        await this.setCount(newCount);
        return { count: newCount };
      }),

    getCount: fn
      .input(z.void())
      .output(z.object({ count: z.number() }))
      .implement(async function () {
        const count = await this.getCount();
        return { count };
      }),
  })
) {}
```

## Error Handling

Safe Durable Objects automatically handles validation errors. If input validation fails, a `ZodError` will be thrown. If output validation fails, it will also throw a `ZodError`.

```typescript
const result = await stub.hello("invalid input").catch((error) => {
  /*handle here*/
});
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT © [Iterate](https://iterate.com)

## Support

If you have any questions or need help, please open an issue on [GitHub](https://github.com/iterate-com/safe-durable-objects).
