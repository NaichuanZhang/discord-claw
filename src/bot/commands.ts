import {
  type Interaction,
  type ApplicationCommandData,
  ApplicationCommandOptionType,
  EmbedBuilder,
  ChannelType,
} from "discord.js";
import { clearSession, resolveSession } from "../agent/sessions.js";
import { getChannelConfig, setChannelConfig, getDb } from "../db/index.js";
import { getSoul } from "../soul/soul.js";
import { triggerRestart } from "../restart.js";
import { startVoice, stopVoice, isConnected } from "../voice/index.js";
import type { SkillService } from "../skills/service.js";
import type { CronService } from "../cron/service.js";
import type { CronJob, CronSchedule, CronPayload, CronDelivery } from "../cron/types.js";

// ---------------------------------------------------------------------------
// Service references (set from index.ts after init)
// ---------------------------------------------------------------------------

let skillService: SkillService | null = null;
let cronService: CronService | null = null;

export function setCommandsSkillService(service: SkillService): void {
  skillService = service;
}

export function setCommandsCronService(service: CronService): void {
  cronService = service;
}

// ---------------------------------------------------------------------------
// Boot timestamp for uptime calculation
// ---------------------------------------------------------------------------

const bootTime = Date.now();

// ---------------------------------------------------------------------------
// Slash command definitions
// ---------------------------------------------------------------------------

export const slashCommands: ApplicationCommandData[] = [
  {
    name: "ping",
    description: "Show bot health status, latency, and uptime",
  },
  {
    name: "help",
    description: "Show bot capabilities and usage info",
  },
  {
    name: "config",
    description: "Show or edit channel configuration",
    options: [
      {
        name: "show",
        description: "Display current channel configuration",
        type: ApplicationCommandOptionType.Subcommand,
      },
      {
        name: "set-prompt",
        description: "Set the system prompt for this channel",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: "prompt",
            description: "The system prompt text",
            type: ApplicationCommandOptionType.String,
            required: true,
          },
        ],
      },
      {
        name: "toggle",
        description: "Enable or disable the bot in this channel",
        type: ApplicationCommandOptionType.Subcommand,
      },
    ],
  },
  {
    name: "clear",
    description: "Clear the current session context",
  },
  {
    name: "soul",
    description: "Show the current soul (personality) content",
  },
  {
    name: "restart",
    description: "Restart the bot process",
  },
  {
    name: "join",
    description: "Join a voice channel to act as a voice assistant",
  },
  {
    name: "leave",
    description: "Leave the current voice channel",
  },
  {
    name: "skills",
    description: "Manage bot skills",
    options: [
      {
        name: "list",
        description: "List installed skills",
        type: ApplicationCommandOptionType.Subcommand,
      },
      {
        name: "add-github",
        description: "Install a skill from a GitHub repository",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: "url",
            description: "GitHub repository URL",
            type: ApplicationCommandOptionType.String,
            required: true,
          },
          {
            name: "name",
            description: "Override skill name",
            type: ApplicationCommandOptionType.String,
            required: false,
          },
        ],
      },
      {
        name: "add-file",
        description: "Install a skill from an uploaded SKILL.md file",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: "file",
            description: "SKILL.md file to upload",
            type: ApplicationCommandOptionType.Attachment,
            required: true,
          },
          {
            name: "name",
            description: "Override skill name",
            type: ApplicationCommandOptionType.String,
            required: false,
          },
        ],
      },
      {
        name: "remove",
        description: "Remove an installed skill",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: "name",
            description: "Name of the skill to remove",
            type: ApplicationCommandOptionType.String,
            required: true,
          },
        ],
      },
    ],
  },
  {
    name: "cron",
    description: "View and manage scheduled cron jobs",
    options: [
      {
        name: "list",
        description: "List all cron jobs",
        type: ApplicationCommandOptionType.Subcommand,
      },
      {
        name: "show",
        description: "Show details for a specific cron job",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: "id",
            description: "Job ID",
            type: ApplicationCommandOptionType.String,
            required: true,
          },
        ],
      },
      {
        name: "add",
        description: "Add a new cron job",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: "name",
            description: "Job name",
            type: ApplicationCommandOptionType.String,
            required: true,
          },
          {
            name: "schedule",
            description: "Cron expression (e.g. '0 9 * * *') or interval (e.g. 'every 30m')",
            type: ApplicationCommandOptionType.String,
            required: true,
          },
          {
            name: "message",
            description: "Agent prompt message to execute on each run",
            type: ApplicationCommandOptionType.String,
            required: true,
          },
          {
            name: "channel",
            description: "Channel to deliver results to (defaults to current)",
            type: ApplicationCommandOptionType.Channel,
            required: false,
          },
          {
            name: "timezone",
            description: "Timezone for cron expression (e.g. America/Los_Angeles)",
            type: ApplicationCommandOptionType.String,
            required: false,
          },
        ],
      },
      {
        name: "remove",
        description: "Remove a cron job",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: "id",
            description: "Job ID to remove",
            type: ApplicationCommandOptionType.String,
            required: true,
          },
        ],
      },
      {
        name: "enable",
        description: "Enable a disabled cron job",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: "id",
            description: "Job ID to enable",
            type: ApplicationCommandOptionType.String,
            required: true,
          },
        ],
      },
      {
        name: "disable",
        description: "Disable a cron job",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: "id",
            description: "Job ID to disable",
            type: ApplicationCommandOptionType.String,
            required: true,
          },
        ],
      },
      {
        name: "run",
        description: "Force-run a cron job immediately",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: "id",
            description: "Job ID to run",
            type: ApplicationCommandOptionType.String,
            required: true,
          },
        ],
      },
      {
        name: "history",
        description: "Show recent run history for a cron job",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: "id",
            description: "Job ID",
            type: ApplicationCommandOptionType.String,
            required: true,
          },
          {
            name: "limit",
            description: "Number of entries to show (default 10)",
            type: ApplicationCommandOptionType.Integer,
            required: false,
          },
        ],
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Interaction handler
// ---------------------------------------------------------------------------

export async function handleInteraction(interaction: Interaction): Promise<void> {
  // Handle button / select menu interactions (placeholder — extend as needed)
  if (interaction.isButton() || interaction.isStringSelectMenu()) {
    await interaction.reply({ content: "Interaction received.", ephemeral: true });
    return;
  }

  // Only handle slash commands from here
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;

  try {
    switch (commandName) {
      case "ping":
        await handlePing(interaction);
        break;
      case "help":
        await handleHelp(interaction);
        break;
      case "config":
        await handleConfig(interaction);
        break;
      case "clear":
        await handleClear(interaction);
        break;
      case "soul":
        await handleSoul(interaction);
        break;
      case "skills":
        await handleSkills(interaction);
        break;
      case "cron":
        await handleCron(interaction);
        break;
      case "join":
        await handleJoin(interaction);
        break;
      case "leave":
        await handleLeave(interaction);
        break;
      case "restart":
        await interaction.reply({ content: "Restarting...", ephemeral: true });
        triggerRestart();
        break;
      default:
        await interaction.reply({
          content: `Unknown command: \`/${commandName}\``,
          ephemeral: true,
        });
    }
  } catch (err) {
    console.error(`[bot] Error handling /${commandName}:`, err);
    const content = "Sorry, something went wrong processing that command.";
    if (interaction.replied || interaction.deferred) {
      await interaction.editReply({ content });
    } else {
      await interaction.reply({ content, ephemeral: true });
    }
  }
}

// ---------------------------------------------------------------------------
// /join
// ---------------------------------------------------------------------------

async function handleJoin(
  interaction: import("discord.js").ChatInputCommandInteraction,
): Promise<void> {
  // Must be in a guild
  if (!interaction.guild) {
    await interaction.reply({
      content: "This command can only be used in a server.",
      ephemeral: true,
    });
    return;
  }

  // Check if already connected
  if (isConnected()) {
    await interaction.reply({
      content: "I'm already in a voice channel. Use `/leave` first.",
      ephemeral: true,
    });
    return;
  }

  // Find the user's voice channel
  const member = await interaction.guild.members.fetch(interaction.user.id);
  const voiceChannel = member.voice.channel;

  if (!voiceChannel) {
    await interaction.reply({
      content: "You need to be in a voice channel first!",
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    await startVoice(voiceChannel);
    await interaction.editReply({
      content: `🎙️ Joined **${voiceChannel.name}**! I'm listening.`,
    });
  } catch (err) {
    await interaction.editReply({
      content: `Failed to join voice channel: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
}

// ---------------------------------------------------------------------------
// /leave
// ---------------------------------------------------------------------------

async function handleLeave(
  interaction: import("discord.js").ChatInputCommandInteraction,
): Promise<void> {
  if (!isConnected()) {
    await interaction.reply({
      content: "I'm not in a voice channel.",
      ephemeral: true,
    });
    return;
  }

  stopVoice();

  await interaction.reply({
    content: "👋 Left the voice channel.",
    ephemeral: true,
  });
}

// ---------------------------------------------------------------------------
// /ping
// ---------------------------------------------------------------------------

function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  parts.push(`${secs}s`);
  return parts.join(" ");
}

async function handlePing(
  interaction: import("discord.js").ChatInputCommandInteraction,
): Promise<void> {
  const client = interaction.client;

  // WebSocket heartbeat latency
  const wsLatency = client.ws.ping;

  // Uptime
  const uptime = Date.now() - bootTime;

  // Health checks
  const dbOk = (() => {
    try {
      getDb().prepare("SELECT 1").get();
      return true;
    } catch {
      return false;
    }
  })();

  const discordOk = client.ws.status === 0;
  const allHealthy = dbOk && discordOk;

  const statusEmoji = allHealthy ? "🟢" : "🔴";
  const statusText = allHealthy ? "All systems operational" : "Degraded";

  const embed = new EmbedBuilder()
    .setTitle(`${statusEmoji} Bot Status`)
    .addFields(
      {
        name: "Latency",
        value: `🏓 **${wsLatency}ms** (WebSocket)`,
        inline: true,
      },
      {
        name: "Uptime",
        value: `⏱️ ${formatUptime(uptime)}`,
        inline: true,
      },
      {
        name: "Health",
        value: [
          `${dbOk ? "✅" : "❌"} Database`,
          `${discordOk ? "✅" : "❌"} Discord Gateway`,
        ].join("\n"),
        inline: false,
      },
      {
        name: "Status",
        value: statusText,
        inline: false,
      },
    )
    .setColor(allHealthy ? 0x57f287 : 0xed4245)
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

// ---------------------------------------------------------------------------
// /help
// ---------------------------------------------------------------------------

async function handleHelp(
  interaction: import("discord.js").ChatInputCommandInteraction,
): Promise<void> {
  const embed = new EmbedBuilder()
    .setTitle("Discordclaw Bot")
    .setDescription("An AI-powered Discord assistant built with Claude.")
    .addFields(
      {
        name: "Talking to the bot",
        value:
          "Mention me in a channel or send me a DM. I will respond using conversation context and memory.",
      },
      {
        name: "Commands",
        value: [
          "`/ping` — Show bot health status",
          "`/help` — Show this message",
          "`/config show` — View channel configuration",
          "`/config set-prompt <prompt>` — Set a channel system prompt",
          "`/config toggle` — Enable/disable bot in this channel",
          "`/clear` — Clear the current session",
          "`/soul` — Show the bot personality",
          "`/join` — Join your voice channel as a voice assistant",
          "`/leave` — Leave the voice channel",
          "`/skills list` — List installed skills",
          "`/skills add-github <url>` — Install skill from GitHub",
          "`/skills add-file <file>` — Install skill from upload",
          "`/skills remove <name>` — Remove a skill",
          "`/cron list` — List cron jobs",
          "`/cron show <id>` — Show job details",
          "`/cron add` — Create a new cron job",
          "`/cron remove <id>` — Delete a cron job",
          "`/cron enable/disable <id>` — Toggle a job",
          "`/cron run <id>` — Force-run a job now",
          "`/cron history <id>` — View run history",
          "`/restart` — Restart the bot process",
        ].join("\n"),
      },
      {
        name: "Features",
        value:
          "Persistent memory, per-channel configuration, conversation sessions, tool use, scheduled tasks, and voice assistant.",
      },
    )
    .setColor(0x5865f2);

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

// ---------------------------------------------------------------------------
// /config
// ---------------------------------------------------------------------------

async function handleConfig(
  interaction: import("discord.js").ChatInputCommandInteraction,
): Promise<void> {
  const subcommand = interaction.options.getSubcommand();
  const channelId = interaction.channelId;

  switch (subcommand) {
    case "show": {
      const config = getChannelConfig(channelId);

      const embed = new EmbedBuilder()
        .setTitle("Channel Configuration")
        .addFields(
          {
            name: "Channel",
            value: `<#${channelId}>`,
            inline: true,
          },
          {
            name: "Enabled",
            value: config ? (config.enabled ? "Yes" : "No") : "Yes (default)",
            inline: true,
          },
          {
            name: "System Prompt",
            value: config?.systemPrompt || "_Not set_",
          },
        )
        .setColor(0x5865f2);

      await interaction.reply({ embeds: [embed], ephemeral: true });
      break;
    }

    case "set-prompt": {
      const prompt = interaction.options.getString("prompt", true);

      setChannelConfig(channelId, {
        guildId: interaction.guildId ?? undefined,
        systemPrompt: prompt,
      });

      await interaction.reply({
        content: `Channel system prompt updated.`,
        ephemeral: true,
      });
      console.log(`[bot] System prompt set for channel ${channelId}`);
      break;
    }

    case "toggle": {
      const existing = getChannelConfig(channelId);
      const newEnabled = existing ? !existing.enabled : false;

      setChannelConfig(channelId, {
        guildId: interaction.guildId ?? undefined,
        enabled: newEnabled,
      });

      await interaction.reply({
        content: `Bot is now **${newEnabled ? "enabled" : "disabled"}** in this channel.`,
        ephemeral: true,
      });
      console.log(`[bot] Channel ${channelId} toggled to enabled=${newEnabled}`);
      break;
    }

    default:
      await interaction.reply({
        content: "Unknown config subcommand.",
        ephemeral: true,
      });
  }
}

// ---------------------------------------------------------------------------
// /clear
// ---------------------------------------------------------------------------

async function handleClear(
  interaction: import("discord.js").ChatInputCommandInteraction,
): Promise<void> {
  const isDM = !interaction.guildId;
  const isThread =
    interaction.channel &&
    "isThread" in interaction.channel &&
    typeof interaction.channel.isThread === "function"
      ? interaction.channel.isThread()
      : false;

  const session = resolveSession({
    threadId: isThread && interaction.channel ? interaction.channel.id : undefined,
    channelId: interaction.channelId,
    userId: interaction.user.id,
    guildId: interaction.guildId ?? undefined,
    isDM,
  });

  clearSession(session.id);

  await interaction.reply({
    content: "Session cleared. I have forgotten our conversation context.",
    ephemeral: true,
  });
  console.log(`[bot] Session ${session.id} cleared by ${interaction.user.tag}`);
}

// ---------------------------------------------------------------------------
// /skills
// ---------------------------------------------------------------------------

async function handleSkills(
  interaction: import("discord.js").ChatInputCommandInteraction,
): Promise<void> {
  if (!skillService) {
    await interaction.reply({
      content: "Skills service is not available.",
      ephemeral: true,
    });
    return;
  }

  const subcommand = interaction.options.getSubcommand();

  switch (subcommand) {
    case "list": {
      const skills = skillService.list();

      if (skills.length === 0) {
        await interaction.reply({
          content: "No skills installed.",
          ephemeral: true,
        });
        return;
      }

      const lines = skills.map((s) => {
        const status = s.enabled ? "On" : "Off";
        const src =
          s.source.type === "github"
            ? "GitHub"
            : s.source.type === "upload"
              ? "Upload"
              : "Local";
        return `**${s.name}** — ${s.description || "_no description_"} [${status}] (${src})`;
      });

      const embed = new EmbedBuilder()
        .setTitle("Installed Skills")
        .setDescription(lines.join("\n"))
        .setFooter({ text: `${skills.length} skill(s)` })
        .setColor(0x5865f2);

      await interaction.reply({ embeds: [embed], ephemeral: true });
      break;
    }

    case "add-github": {
      const url = interaction.options.getString("url", true);
      const name = interaction.options.getString("name") ?? undefined;

      await interaction.deferReply({ ephemeral: true });

      try {
        const skill = await skillService.installFromGitHub({ url, name });
        await interaction.editReply({
          content: `Skill **${skill.name}** installed from GitHub.`,
        });
        console.log(`[bot] Skill installed via /skills add-github: ${skill.name}`);
      } catch (err) {
        await interaction.editReply({
          content: `Failed to install skill: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
      break;
    }

    case "add-file": {
      const attachment = interaction.options.getAttachment("file", true);
      const name = interaction.options.getString("name") ?? undefined;

      await interaction.deferReply({ ephemeral: true });

      try {
        // Fetch the attachment content
        const response = await fetch(attachment.url);
        if (!response.ok) {
          await interaction.editReply({
            content: `Failed to download attachment: ${response.statusText}`,
          });
          return;
        }
        const content = await response.text();

        const skill = await skillService.installFromUpload({ content, name });
        await interaction.editReply({
          content: `Skill **${skill.name}** installed from upload.`,
        });
        console.log(`[bot] Skill installed via /skills add-file: ${skill.name}`);
      } catch (err) {
        await interaction.editReply({
          content: `Failed to install skill: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
      break;
    }

    case "remove": {
      const name = interaction.options.getString("name", true);
      const skill = skillService.getByName(name);

      if (!skill) {
        await interaction.reply({
          content: `Skill **${name}** not found.`,
          ephemeral: true,
        });
        return;
      }

      const removed = skillService.remove(skill.id);
      if (!removed) {
        await interaction.reply({
          content: `Failed to remove skill **${name}**.`,
          ephemeral: true,
        });
        return;
      }

      await interaction.reply({
        content: `Skill **${name}** removed.`,
        ephemeral: true,
      });
      console.log(`[bot] Skill removed via /skills remove: ${name}`);
      break;
    }

    default:
      await interaction.reply({
        content: "Unknown skills subcommand.",
        ephemeral: true,
      });
  }
}

// ---------------------------------------------------------------------------
// /cron
// ---------------------------------------------------------------------------

function formatSchedule(schedule: CronSchedule): string {
  switch (schedule.type) {
    case "at":
      return `Once at <t:${Math.floor(schedule.timestamp / 1000)}:F>`;
    case "every": {
      const ms = schedule.intervalMs;
      if (ms < 60_000) return `Every ${Math.round(ms / 1000)}s`;
      if (ms < 3_600_000) return `Every ${Math.round(ms / 60_000)}m`;
      if (ms < 86_400_000) return `Every ${Math.round(ms / 3_600_000)}h`;
      return `Every ${Math.round(ms / 86_400_000)}d`;
    }
    case "cron":
      return `\`${schedule.expression}\`${schedule.tz ? ` (${schedule.tz})` : ""}`;
    default:
      return "Unknown";
  }
}

function formatPayload(payload: CronPayload): string {
  if (payload.kind === "systemEvent") {
    return `System event: ${payload.text}`;
  }
  if (payload.kind === "agentTurn") {
    const msg = payload.message.length > 100
      ? payload.message.slice(0, 100) + "…"
      : payload.message;
    return `Agent turn: ${msg}`;
  }
  return "Unknown";
}

/**
 * Parse a schedule string from the user into a CronSchedule.
 */
function parseScheduleInput(input: string, tz?: string): CronSchedule {
  const everyMatch = input.match(/^every\s+(\d+)\s*(s|sec|second|seconds|m|min|minute|minutes|h|hr|hour|hours|d|day|days)$/i);
  if (everyMatch) {
    const value = parseInt(everyMatch[1], 10);
    const unit = everyMatch[2].toLowerCase();
    let ms: number;
    if (unit.startsWith("s")) ms = value * 1000;
    else if (unit.startsWith("m")) ms = value * 60_000;
    else if (unit.startsWith("h")) ms = value * 3_600_000;
    else ms = value * 86_400_000;
    return { type: "every", intervalMs: ms };
  }

  // Otherwise treat as cron expression
  return { type: "cron", expression: input.trim(), tz };
}

async function handleCron(
  interaction: import("discord.js").ChatInputCommandInteraction,
): Promise<void> {
  if (!cronService) {
    await interaction.reply({
      content: "Cron service is not available.",
      ephemeral: true,
    });
    return;
  }

  const subcommand = interaction.options.getSubcommand();

  switch (subcommand) {
    case "list": {
      const jobs = cronService.list();

      if (jobs.length === 0) {
        await interaction.reply({
          content: "No cron jobs configured.",
          ephemeral: true,
        });
        return;
      }

      const lines = jobs.map((job) => {
        const status = job.enabled ? "🟢" : "🔴";
        const schedule = formatSchedule(job.schedule);
        const nextRun = job.state.nextRunAtMs
          ? `<t:${Math.floor(job.state.nextRunAtMs / 1000)}:R>`
          : "—";
        return `${status} **${job.name}** (\`${job.id}\`)\n  Schedule: ${schedule} · Next: ${nextRun}`;
      });

      const embed = new EmbedBuilder()
        .setTitle("⏰ Cron Jobs")
        .setDescription(lines.join("\n\n"))
        .setFooter({ text: `${jobs.length} job(s)` })
        .setColor(0x5865f2);

      await interaction.reply({ embeds: [embed], ephemeral: true });
      break;
    }

    case "show": {
      const id = interaction.options.getString("id", true);
      const job = cronService.get(id);

      if (!job) {
        await interaction.reply({
          content: `Job \`${id}\` not found.`,
          ephemeral: true,
        });
        return;
      }

      const embed = buildJobDetailEmbed(job);
      await interaction.reply({ embeds: [embed], ephemeral: true });
      break;
    }

    case "add": {
      const name = interaction.options.getString("name", true);
      const scheduleInput = interaction.options.getString("schedule", true);
      const message = interaction.options.getString("message", true);
      const channel = interaction.options.getChannel("channel");
      const timezone = interaction.options.getString("timezone") ?? undefined;

      const deliveryChannelId = channel?.id ?? interaction.channelId;

      let schedule: CronSchedule;
      try {
        schedule = parseScheduleInput(scheduleInput, timezone);
      } catch {
        await interaction.reply({
          content: `Invalid schedule: \`${scheduleInput}\`. Use a cron expression or \`every <N>m/h/d\`.`,
          ephemeral: true,
        });
        return;
      }

      const payload: CronPayload = { kind: "agentTurn", message };
      const delivery: CronDelivery = {
        channelId: deliveryChannelId,
        mentionUser: interaction.user.id,
      };

      const job = cronService.add({
        name,
        enabled: true,
        schedule,
        payload,
        delivery,
      });

      const nextRun = job.state.nextRunAtMs
        ? `<t:${Math.floor(job.state.nextRunAtMs / 1000)}:R>`
        : "not scheduled";

      await interaction.reply({
        content: `✅ Cron job **${name}** created (\`${job.id}\`). Next run: ${nextRun}`,
        ephemeral: true,
      });
      console.log(`[bot] Cron job created via /cron add: "${name}" (${job.id})`);
      break;
    }

    case "remove": {
      const id = interaction.options.getString("id", true);
      const job = cronService.get(id);

      if (!job) {
        await interaction.reply({
          content: `Job \`${id}\` not found.`,
          ephemeral: true,
        });
        return;
      }

      const removed = cronService.remove(id);
      await interaction.reply({
        content: removed
          ? `🗑️ Job **${job.name}** (\`${id}\`) removed.`
          : `Failed to remove job \`${id}\`.`,
        ephemeral: true,
      });
      if (removed) {
        console.log(`[bot] Cron job removed via /cron remove: "${job.name}" (${id})`);
      }
      break;
    }

    case "enable": {
      const id = interaction.options.getString("id", true);
      const job = cronService.update(id, { enabled: true });

      if (!job) {
        await interaction.reply({
          content: `Job \`${id}\` not found.`,
          ephemeral: true,
        });
        return;
      }

      const nextRun = job.state.nextRunAtMs
        ? `<t:${Math.floor(job.state.nextRunAtMs / 1000)}:R>`
        : "not scheduled";

      await interaction.reply({
        content: `🟢 Job **${job.name}** enabled. Next run: ${nextRun}`,
        ephemeral: true,
      });
      console.log(`[bot] Cron job enabled via /cron enable: "${job.name}" (${id})`);
      break;
    }

    case "disable": {
      const id = interaction.options.getString("id", true);
      const job = cronService.update(id, { enabled: false });

      if (!job) {
        await interaction.reply({
          content: `Job \`${id}\` not found.`,
          ephemeral: true,
        });
        return;
      }

      await interaction.reply({
        content: `🔴 Job **${job.name}** disabled.`,
        ephemeral: true,
      });
      console.log(`[bot] Cron job disabled via /cron disable: "${job.name}" (${id})`);
      break;
    }

    case "run": {
      const id = interaction.options.getString("id", true);
      const job = cronService.get(id);

      if (!job) {
        await interaction.reply({
          content: `Job \`${id}\` not found.`,
          ephemeral: true,
        });
        return;
      }

      await interaction.deferReply({ ephemeral: true });

      try {
        await cronService.forceRun(id);
        await interaction.editReply({
          content: `▶️ Job **${job.name}** executed successfully.`,
        });
      } catch (err) {
        await interaction.editReply({
          content: `❌ Job **${job.name}** failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
      console.log(`[bot] Cron job force-run via /cron run: "${job.name}" (${id})`);
      break;
    }

    case "history": {
      const id = interaction.options.getString("id", true);
      const limit = interaction.options.getInteger("limit") ?? 10;
      const job = cronService.get(id);

      if (!job) {
        await interaction.reply({
          content: `Job \`${id}\` not found.`,
          ephemeral: true,
        });
        return;
      }

      const runs = cronService.getRunHistory(id, limit);

      if (runs.length === 0) {
        await interaction.reply({
          content: `No run history for job **${job.name}**.`,
          ephemeral: true,
        });
        return;
      }

      const lines = runs.map((run) => {
        const status = run.status === "ok" ? "✅" : run.status === "error" ? "❌" : "⏭️";
        const time = `<t:${Math.floor(run.startedAt / 1000)}:R>`;
        const duration = `${Math.round((run.completedAt - run.startedAt) / 1000)}s`;
        const detail = run.error ? ` — \`${run.error.slice(0, 80)}\`` : "";
        return `${status} ${time} (${duration})${detail}`;
      });

      const embed = new EmbedBuilder()
        .setTitle(`📜 Run History — ${job.name}`)
        .setDescription(lines.join("\n"))
        .setFooter({ text: `Showing ${runs.length} most recent run(s)` })
        .setColor(0x5865f2);

      await interaction.reply({ embeds: [embed], ephemeral: true });
      break;
    }

    default:
      await interaction.reply({
        content: "Unknown cron subcommand.",
        ephemeral: true,
      });
  }
}

function buildJobDetailEmbed(job: CronJob): EmbedBuilder {
  const status = job.enabled ? "🟢 Enabled" : "🔴 Disabled";
  const schedule = formatSchedule(job.schedule);
  const payload = formatPayload(job.payload);
  const nextRun = job.state.nextRunAtMs
    ? `<t:${Math.floor(job.state.nextRunAtMs / 1000)}:F> (<t:${Math.floor(job.state.nextRunAtMs / 1000)}:R>)`
    : "—";
  const lastRun = job.state.lastRunAtMs
    ? `<t:${Math.floor(job.state.lastRunAtMs / 1000)}:R> — ${job.state.lastRunStatus ?? "unknown"}`
    : "Never";
  const delivery = job.delivery
    ? `<#${job.delivery.channelId}>${job.delivery.mentionUser ? ` (mention <@${job.delivery.mentionUser}>)` : ""}`
    : "None";

  const fields = [
    { name: "Status", value: status, inline: true },
    { name: "Schedule", value: schedule, inline: true },
    { name: "Next Run", value: nextRun, inline: false },
    { name: "Last Run", value: lastRun, inline: false },
    { name: "Payload", value: payload, inline: false },
    { name: "Delivery", value: delivery, inline: false },
  ];

  if (job.state.lastError) {
    fields.push({
      name: "Last Error",
      value: `\`\`\`${job.state.lastError.slice(0, 200)}\`\`\``,
      inline: false,
    });
  }

  if (job.state.consecutiveErrors && job.state.consecutiveErrors > 0) {
    fields.push({
      name: "Consecutive Errors",
      value: `${job.state.consecutiveErrors}`,
      inline: true,
    });
  }

  return new EmbedBuilder()
    .setTitle(`⏰ ${job.name}`)
    .setDescription(`ID: \`${job.id}\`${job.description ? `\n${job.description}` : ""}`)
    .addFields(fields)
    .setColor(job.enabled ? 0x57f287 : 0xed4245)
    .setFooter({ text: `Created ${new Date(job.createdAt).toISOString()}` });
}

// ---------------------------------------------------------------------------
// /soul
// ---------------------------------------------------------------------------

async function handleSoul(
  interaction: import("discord.js").ChatInputCommandInteraction,
): Promise<void> {
  const soul = getSoul();

  if (!soul) {
    await interaction.reply({
      content: "No soul content is currently loaded.",
      ephemeral: true,
    });
    return;
  }

  // Truncate if necessary (embed description limit is 4096)
  const display = soul.length > 4000
    ? soul.slice(0, 4000) + "\n\n_...truncated_"
    : soul;

  const embed = new EmbedBuilder()
    .setTitle("Soul")
    .setDescription(display)
    .setColor(0x5865f2);

  await interaction.reply({ embeds: [embed], ephemeral: true });
}
