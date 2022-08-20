/*
 * Copyright 2020 The Backstage Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { CatalogClient, GetEntitiesResponse } from '@backstage/catalog-client';
import { Entity, EntityRelation } from '@backstage/catalog-model';
import { errorHandler } from '@backstage/backend-common';
import { Message, Blocks, Md, Button } from 'slack-block-builder'
import express from 'express';
import Router from 'express-promise-router';
import { Logger } from 'winston';
import { Config } from '@backstage/config';
import { App } from '@slack/bolt'

export interface RouterOptions {
  logger: Logger;
  config: Config;
  catalog: CatalogClient;
}


export async function createRouter(
  options: RouterOptions,
): Promise<express.Router> {
  const { logger, config, catalog } = options;

  let configValid = true

  if (!config.getOptionalString('slackbot.botToken') ||
      !config.getOptionalString('slackbot.signingSecret') ||
      !config.getOptionalString('slackbot.appToken')) {
    configValid = false
  }

  const router = Router();
  router.use(express.json());

  router.get('/health', (_, response) => {
    logger.info('PONG!');
    let status = 'unhealthy'
    if (configValid) {
      status = 'healthy'
    }
    response.send({ status });
  });
  router.use(errorHandler());

  async function addUserContext({ payload, context, next }) {
    const slackUserId: string = payload.user
    
    const res = await resolveSlackId(slackUserId)

    if (!res) {
      console.error(`Found no catalog entry for ${slackUserId}`)
    }

    if (res.length > 1) {
      console.error(`Found multiple catalog entries for ${slackUserId}`)
    }

    if (res.length === 1) {
      context.user = res[0]
    }

    await next();
  }

  async function resolveQuery(query: string) {
    const filter = { 'metadata.name': query }
    let res: GetEntitiesResponse = await catalog.getEntities({ filter })
    if (!res.items.length) {
      res = await catalog.getEntities(
        { filter: { 'metadata.annotations.slack.com/user-id': query }
      })
    }
    if (!res.items.length) {
      res = await catalog.getEntities(
        { filter: { 'metadata.annotations.pagerduty.com/user-id': query }
      })
    }
    if (!res.items.length) {
      res = await catalog.getEntities(
        { filter: { 'metadata.annotations.github.com/user-login': query }
      })
    }
    return res.items
  }

  async function resolveSlackId(userSlackId: string) {
    const filter = {
      'metadata.annotations.slack.com/user-id': userSlackId
    }
    const res: GetEntitiesResponse = await catalog.getEntities({ filter })
    return res.items
  }

  function buildHelpMenu() {
    const message = Message({ text: "Hey there 👋 I'm the Backstage helper bot. My job is to help you get the information you need about the <COOL COMPANY HERE> software ecosystem with as little friction as possible."})
      .blocks(
        Blocks.Section({ text: Md.bold('There are only a handful of commands you need to remember to use me:') }),
        Blocks.Section({ text: `${Md.codeInline('@xs-backstage help')}: You've already discovered this one. It presents the help menu that you're currently reading right now. Use it anytime to refresh your memory on how to search for Backstage entities.` }),
        Blocks.Section({ text: `${Md.codeInline('@xs-backstage find [query]')}: Whatever you're looking for, I'll try my best to figure out the details for you. If I can't find an exact match, I'll present you a list of the things I do know about to hopefully narrow down your query. See below for some example queries.`}),
        Blocks.Divider(),
        Blocks.Section({ text: Md.bold('Here are some example queries to get you started:') }),
        Blocks.Section({ text: `${Md.codeInline('@xs-backstage find cool-tuna')}\nLearn about the Cool Tuna team and who its members are` }),
        Blocks.Section({ text: `${Md.codeInline('@xs-backstage find hotdog')}\nLearn about the Hotdog system and the components that make it up` }),
        // Blocks.Section({ text: `${Md.codeInline('@xs-backstage find bread-maker')}\nLearn about the bread-maker component` }),
        Blocks.Section({ text: `${Md.codeInline('@xs-backstage find jane.doe')}\nLearn about your coworker Jane and where you can find her on Slack, Github and Pagerduty` }),
        // Blocks.Section({ text: `${Md.codeInline('@xs-backstage find toot')}\nLearn about the toot Golang library` }),
        Blocks.Section({ text: `${Md.codeInline('@xs-backstage find shopify')}\nLearn about the Shopify SaaS product and which team looks after our relationship with it` }),
        Blocks.Divider(),
        Blocks.Section({ text: Md.bold("Some background on how searching works:") }),
        Blocks.Section({ text: `An ${Md.link('https://backstage.io/docs/features/software-catalog/system-model', 'entity')} in Backstage can represent any number of things: a system, component, team, person or even a Saas product\n\nFor the sake of simplicity, don't worry too much about the details while getting started. Just try searching for something you're interested in. 9 times out of 10, you can just enter the name of a thing in lowercase with spaces replaced with dashes and you'll find a hit.\n\nThe ${Md.codeInline('find')} function will return an exact match if the provided input is exactly the same as the ID for a Backstage entity. You can find these IDs by navigating to an entity in Backstage and looking at the ID in the URL.\n\nIf you provide a non-exact match (ie; a System and Component have the same names), a list will be returned and you'll be asked to select the item that matches what you were looking for.` }),
        Blocks.Divider(),
        Blocks.Context()
          .elements(`👀 Psst, you can view your own Backstage entry with ${Md.codeInline('@xs-backstage whoami')} if one exists.\n❓ Reach out to ${Md.channel('CHANNEL')} to get help\n🏗 I may fall back to linking you to the relevant Backstage URL if I can't format the results for Slack.`))
      .buildToJSON()
    return JSON.parse(message)
  }

  function dynamicContext(entity: Entity) {
    let extraContext = `Please let us know in ${Md.channel('CHANNEL')} so we can work together to correct any mistakes.`
    if (entity) {
      const editUrl = entity.metadata.annotations?.['backstage.io/edit-url']
      if (editUrl) {
        extraContext = `If you're up for it, you can edit this Group definition via ${Md.link(editUrl, 'Github')} otherwise you can reach out to ${Md.channel('CHANNEL')} for assistance`
      }
    }
    return Blocks.Context()
      .elements(`${Md.emoji('question')} Does something seem off? ${extraContext}`)
  }

  async function buildSystem(system: Entity) {

    const components = []

    if (system.relations && Array.isArray(system.relations)) {
      for (const relative of system.relations) {
        if (relative.type === "hasPart" && relative.target.kind === "component") {
          components.push(
            Md.link(
              `https://backstage.example.com/catalog/default/component/${relative.target.name}`,
              relative.target.name
            )
          )
        }
      }
    }

    const links = []

    if (system.metadata.links && Array.isArray(system.metadata.links)) {
      for (const link of system.metadata.links) {
        links.push(Md.link(link.url, link.title))
      }
    }

    const ownerLink = Md.bold(
      Md.link(
        `https://backstage.example.com/catalog/default/group/${system.spec?.owner}`,
        system.spec?.owner
      )
    )

    const suggestion =  Md.codeInline(`@xs-backstage find ${system.spec?.owner}`)
    const message = Message({ text: `Here's what I know about ${system.metadata.name}` })
      .blocks(
        Blocks.Section({
          text: `${Md.bold(system.metadata.name)}\n${Md.blockquote(system.metadata.description || "I'm not sure what this system does")}`
        }),
        Blocks.Section({
          text: `${ownerLink} are known to look after it\nI can tell you more details if you say ${suggestion}`
        }),
        Blocks.Section({
          text: `${Md.bold("Relevant Links")}\n${Md.listBullet(links)}`
        }),
        Blocks.Section({
          text: `${Md.bold("Known Components")}\n${Md.listBullet(components)}`
        }),
        dynamicContext(system)
      )
      .buildToJSON()
    return JSON.parse(message)
  }

  async function buildGroup(group: Entity) {

    const members = []
    
    if (group.spec?.members && Array.isArray(group.spec?.members)) {
      for (const member of group.spec?.members) {
        const [memberProfile] = await resolveQuery(member)
        const name = memberProfile.spec?.profile?.displayName
        const role = memberProfile.metadata.description || 'Mystery Role'
        members.push(`${name} - ${Md.italic(role)}`)
      }
    }

    const links = []

    if (group.metadata.links && Array.isArray(group.metadata.links)) {
      for (const link of group.metadata.links) {
        links.push(Md.link(link.url, link.title))
      }
    }

    const message = Message({ text: `Here's what I know about ${group.spec?.profile?.displayName}` })
      .blocks(
        Blocks.Section({
          text: `${Md.bold(group.spec?.profile?.displayName)}\n${Md.blockquote(group.metadata?.description || 'They seem to be a bit of a mystery!')}`
        })
          .accessory(
            Button({ text: "View more details in Backstage" })
              .url(`https://backstage.example.com/catalog/default/group/${group.metadata.name}`)),
        Blocks.Section({ text: `They should be reachable over at #${group.spec?.profile?.slack}`}),
        Blocks.Section({
          text: `${Md.bold("Members")}:\n${Md.listBullet(members)}`
        }),
        Blocks.Section({
          text: `${Md.bold("Relevant Links")}\n${Md.listBullet(links)}`
        }),
        dynamicContext(group)
      )
      .buildToJSON()
    return JSON.parse(message)
  }
  
  function parseMessage(blocks: string | any[] | undefined) {
    if (!Array.isArray(blocks) || blocks.length === 0) return []
    if (!Object.keys(blocks[0]).includes('elements')) return []
    if (!Object.keys(blocks[0].elements[0]).includes('elements')) return []
    const innerElements = blocks[0].elements[0].elements
    if (innerElements.length === 1) return [] // The user may just be telling another user that this bot exists ie; "Try asking @backstage" so we'll ignore this message that has no commands
    if (innerElements.length === 3 && innerElements[2].type === 'user') {
      // As a nice hidden feature, we'll allow users to find other Cool Company Staff by tagging them eg; if you want to find a coworker on Github
      return ['findSlack', innerElements[2].user_id]
    }
    if (innerElements.length > 2) return ['help'] // The user has used a second tag ie "@backstage list @backstage" or done something weird so we'll just return the help menu
    const messageBlock = innerElements[1].text.trim()
    return messageBlock.split(' ').map((e: string) => e.toLowerCase())
  }

  const mockApp = {
    use: (...args: any) =>  args,
    event: (...args: any) => args,
    error: (...args: any) => args,
    start: (...args: any) => args
  }

  const app = configValid ? new App({
    token: config.getOptionalString('slackbot.botToken'),
    signingSecret: config.getOptionalString('slackbot.signingSecret'),
    appToken: config.getOptionalString('slackbot.appToken'),
    socketMode: true
  }) : mockApp

  const plainText = (text: string) => ({ text })

  app.use(addUserContext) // Automatically adds the user's Backstage entity to messages (under context.user) but we still need to explicitly do it for other types like events, commands and so on

  app.event('app_mention', addUserContext, async({ event, context, client }) => {
    const message = parseMessage(event.blocks)

    await client.reactions.add({
      channel: event.channel,
      timestamp: event.ts,
      name: "floppy_disk"
    })

    if (!message) {
      logger.error(event)
      const badEventMessage = plainText(`I dunno what you just said but I heard a malformed event and I don't know how to react!\nPlease share the following timestamp in #cool-company-channel: ${event.event_ts} to help us debug this issue.`)
      await client.chat.postMessage({
        ...badEventMessage,
        channel: event.channel,
        thread_ts: event.ts
      })
      return
    }

    try {
      let response = buildHelpMenu()
      if (message.length === 1) {
        const text = message[0].trim().toLowerCase()

        if (text === 'whoami') {
          response = buildWhoAmI(context.user)
        }
      }

      if (message.length === 2 && message[0] === "find") {
        const entityId = message[1].trim().toLowerCase()
        const res = await resolveQuery(entityId)

        response = plainText(`Sorry, I don't know anything about ${entityId}!`)

        if (res.length === 1) {
          response = await formatEntity(res[0])
        }

        if (res.length > 1) {
          response = plainText(`I found multiple results for ${entityId}. Try asking me when I'm smarter!`)
        }

        const bestMatchEntity = (entities: Entity[]) => entities.filter(e => e.kind.toLowerCase() === "system")

        if (res.length > 1) {
          const closestMatch = bestMatchEntity(res)
          if (closestMatch.length === 1) {
            const match = closestMatch[0]
            response = await formatEntity(match)
          } else {
            response = plainText(`I found multiple results for ${entityId}. I tried to pick the best one for you but I couldn't make up my mind! Try asking me when I'm smarter.`)
          }
        }
      }

      if (message.length === 2 && message[0] === "findSlack") {
        const slackId = message[1]
        const res = await resolveSlackId(slackId)
        if (res) {
          response = await formatEntity(res[0])
        } else {
          response = plainText(`Sorry, I've never met that person! Strange since their Slack ID should be present on their Backstage User entity.`)
        }
      }

      await client.chat.postMessage({
        ...response,
        channel: event.channel,
        thread_ts: event.ts
      })

      await client.reactions.add({
        channel: event.channel,
        timestamp: event.ts,
        name: "white_check_mark"
      })
    } catch (error) {

      await client.chat.postMessage({
        text: "Wah wah, I wasn't able to complete this query! Please let #cool-company-channel know so we can look into it.",
        channel: event.channel,
        thread_ts: event.ts
      })
      
      await client.reactions.add({
        channel: event.channel,
        timestamp: event.ts,
        name: "x"
      })

    } finally {
      await client.reactions.remove({
        channel: event.channel,
        timestamp: event.ts,
        name: "floppy_disk"
      })
    }
  })

  async function formatEntity(res: Entity) {
    console.log(res)
    switch(res.kind.toLowerCase()) {
      case 'user':
        return buildWhoAmI(res)
      case 'group':
        return await buildGroup(res)
      case 'system':
        return buildSystem(res)
      default:
        return plainText(`I found a match but I don't know how to display it in Slack just yet. You can view it in Backstage by visiting https://backstage.example.com/catalog/default/${res.kind.toLowerCase()}/${res.metadata.name}`)
    }
  }

  function buildWhoAmI(user: Entity) {
    if (!user) {
      const message = Message({ text: "I couldn't find that person in Backstage." })
        .blocks(
          Blocks.Section({
            text: "Sorry, we've never met! It may also be the case that Backstage has been freshly deployed. You can try again in a minute and see if that fixes things."
          })
        )
        .buildToJSON()
      return JSON.parse(message)
    }

    function iterateGroups(relations: EntityRelation[] | undefined) {
      if (!relations) return ": No relations found"
      let relationsList = "\n"
      for (const entry of relations) {
        relationsList += `• ${entry.type} ${entry.targetRef}\n`
      }
      return relationsList
    }

    const profile = [
      // `${Md.bold("Product")}: ${user.spec?.profile?.product || 'Not Found'}`,
      // `${Md.bold("Subproduct")}: ${user.spec?.profile?.subproduct || 'Not Found'}`,
      // `${Md.bold("Discipline")}: ${user.spec?.profile?.discipline || 'Not Found'}`,
      // `${Md.bold("Office Location")}: ${user.spec?.profile?.location || 'Not Found'}`,
      `${Md.bold("Timezone")}: ${user.spec?.profile?.timezone || 'Not Found'}`
    ]

    const accounts = [
      `${Md.bold("Github")}: ${user.metadata.annotations?.['github.com/user-login'] || 'Not Found'}`,
      `${Md.bold("Pagerduty")}: ${user.metadata.annotations?.['pagerduty.com/user-id'] || 'Not Found'}`,
      `${Md.bold("Slack")}: ${user.metadata.annotations?.['slack.com/user-id'] || 'Not Found'}`,
    ]

    const message = Message({ text: `Here's what I know about ${user.spec?.profile?.displayName}` })
      .blocks(
        Blocks.Section({  
          text: `${Md.bold(user.spec?.profile?.displayName)}\n${user.metadata.description}`,
        })
          .accessory(
            Button({ text: "View more details in Backstage" })
              .url(`https://backstage.example.com/catalog/default/user/${user.metadata.name}`)),
        Blocks.Divider(),
        Blocks.Section({
          text: profile.join("\n")
        }),
        Blocks.Section({
          text: accounts.join("\n")
        }),
        Blocks.Divider(),
        Blocks.Section({
          text: `*Related to these Backstage entities*${iterateGroups(user.relations)}`
        }),
        dynamicContext(user)
      )
      .buildToJSON()
    return JSON.parse(message)
  }

  app.error(error => {
    logger.error(error)
  });

  if (configValid) {
    (async () => {
      await app.start()
      logger.info("Slackbot is running")
    })()
  } else {
    logger.info("Configuration for Slackbot is missing or invalid. Continuing without contacting Slack.")
  }

  return router;
}
