import {
  type Interaction,
  type ApplicationCommandData,
  ApplicationCommandOptionType,
  EmbedBuilder,
} from "discord.js";
import { listSessions, clearSession, resolveSession } from "../agent/sessions.js";
import { getChannelConfig, setChannelConfig } from "../db/index.js";
import { getSoul } from "../soul/soul.js";
import { triggerRestart } from "../restart.js";
import { handleComponentInteraction } from "./components.js";

// ---------------------------------------------------------------------------
// Slash command definitions
// ---------------------------------------------------------------------------

export const slashCommands: ApplicationCommandData[] = [
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
    name: "forget",
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
      case "help":
        await handleHelp(interaction);
        break;
      case "config":
        await handleConfig(interaction);
        break;
      case "sessions":
        await handleSessions(interaction);
        break;
      case "forget":
        await handleForget(interaction);
        break;
      case "soul":
        await handleSoul(interaction);
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
          "`/help` — Show this message",
          "`/config show` — View channel configuration",
          "`/config set-prompt <prompt>` — Set a channel system prompt",
          "`/config toggle` — Enable/disable bot in this channel",
          "`/sessions` — List recent sessions",
          "`/forget` — Clear the current session",
          "`/soul` — Show the bot personality",
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
// /forget
// ---------------------------------------------------------------------------

async function handleForget(
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
