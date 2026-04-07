import {
  type Interaction,
  type ApplicationCommandData,
  ApplicationCommandOptionType,
  EmbedBuilder,
} from "discord.js";
import { listSessions, clearSession, resolveSession } from "../agent/sessions.js";
import { getChannelConfig, setChannelConfig, getDb } from "../db/index.js";
import { getSoul } from "../soul/soul.js";
import { triggerRestart } from "../restart.js";
import { handleComponentInteraction } from "./components.js";
import type { SkillService } from "../skills/service.js";

// ---------------------------------------------------------------------------
// SkillService reference (set from index.ts after init)
// ---------------------------------------------------------------------------

let skillService: SkillService | null = null;

export function setCommandsSkillService(service: SkillService): void {
  skillService = service;
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
    name: "sessions",
    description: "List recent conversation sessions",
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
];

// ---------------------------------------------------------------------------
// Interaction handler
// ---------------------------------------------------------------------------

export async function handleInteraction(interaction: Interaction): Promise<void> {
  // Handle button / select menu interactions
  if (interaction.isButton() || interaction.isStringSelectMenu()) {
    await handleComponentInteraction(interaction);
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
      case "sessions":
        await handleSessions(interaction);
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
          "`/sessions` — List recent sessions",
          "`/clear` — Clear the current session",
          "`/soul` — Show the bot personality",
          "`/skills list` — List installed skills",
          "`/skills add-github <url>` — Install skill from GitHub",
          "`/skills add-file <file>` — Install skill from upload",
          "`/skills remove <name>` — Remove a skill",
          "`/restart` — Restart the bot process",
        ].join("\n"),
      },
      {
        name: "Features",
        value:
          "Persistent memory, per-channel configuration, conversation sessions, tool use, and scheduled tasks.",
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
// /sessions
// ---------------------------------------------------------------------------

async function handleSessions(
  interaction: import("discord.js").ChatInputCommandInteraction,
): Promise<void> {
  const guildId = interaction.guildId ?? undefined;
  const { sessions, total } = listSessions({ guildId, limit: 10 });

  if (sessions.length === 0) {
    await interaction.reply({
      content: "No active sessions found.",
      ephemeral: true,
    });
    return;
  }

  const lines = sessions.map((s, i) => {
    const age = Math.round((Date.now() - s.lastActive) / 60_000);
    const ageStr = age < 60 ? `${age}m ago` : `${Math.round(age / 60)}h ago`;
    const userPart = s.userId ? `<@${s.userId}>` : "unknown";
    return `**${i + 1}.** ${s.discordKey} — ${userPart} — last active ${ageStr}`;
  });

  const embed = new EmbedBuilder()
    .setTitle("Recent Sessions")
    .setDescription(lines.join("\n"))
    .setFooter({ text: `Showing ${sessions.length} of ${total} session(s)` })
    .setColor(0x5865f2);

  await interaction.reply({ embeds: [embed], ephemeral: true });
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
