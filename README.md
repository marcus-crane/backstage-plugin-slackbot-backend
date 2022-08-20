# Slackbot

> This plugin is **NOT** a good example of a Backstage backend plugin. It does not adhere to the traditional set of APIs that you would encounter when developing a plugin for Backstage, as it does not serve web content. You should not use it but it was open sourced upon request. It is best served as inspiration for something built from the ground up and nothing more.

This is a backend plugin for Backstage that spins up [bolt.js](https://slack.dev/bolt-js/concepts)-powered Slackbot.

The bot is able to make use of the various internal Backstage APIs available to query catalog entries and map the interacting user to a catalog entry.

It hooks up to `packages/backend/src/index.ts` but it's not a true plugin router since it connects to Slack rather than receiving messages.

The example below is a rough idea of how to hook it up but not a full working example.
```js
import slackbot from './plugins/slackbot'

async function main() {

  const slackbotEnv = useHotMemoize(module, () => createEnv('slackbot'))

  const apiRouter = Router();
  
  apiRouter.use('/slackbot', await slackbot(slackbotEnv))

  // Add backends ABOVE this line; this 404 handler is the catch-all fallback
  apiRouter.use(notFoundHandler());

  const service = createServiceBuilder(module)
    .loadConfig(config)
    .addRouter('', await healthcheck(healthcheckEnv))
    .addRouter('/api', apiRouter)
    .addRouter('', await app(appEnv));

  await service.start().catch(err => {
    console.log(err);
    process.exit(1);
  });
}
```