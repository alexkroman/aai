import { defineAgent } from "@aai/sdk";
import { z } from "zod";

// Per-session game state
const sessions = new Map<string, {
  inventory: string[];
  currentRoom: string;
  score: number;
  moves: number;
  flags: Record<string, boolean>;
  history: string[];
}>();

function getOrCreateSession(sessionId: string) {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, {
      inventory: [],
      currentRoom: "West of House",
      score: 0,
      moves: 0,
      flags: {},
      history: [],
    });
  }
  return sessions.get(sessionId)!;
}

export default defineAgent({
  name: "Infocom Adventure",
  voice: "orion",
  prompt:
    "Speak in a dramatic, atmospheric tone. Use pauses for suspense. Lower your voice for dark or dangerous moments. Be theatrical but not over the top.",
  greeting:
    "Welcome to the great underground empire. You are standing in an open field west of a white house, with a boarded front door. There is a small mailbox here. What would you like to do?",
  instructions:
    `You are a classic Infocom-style text adventure game engine, simulating ZORK I: The Great Underground Empire.

You ARE the game. You maintain the world state, describe rooms, handle puzzles, manage inventory, track score, and respond to player commands — all faithfully recreating the Zork experience.

GAME WORLD RULES:
- Follow the geography, puzzles, and items of Zork I as closely as you can recall
- The map includes: West of House, North of House, Behind House, South of House, Kitchen, Living Room, Attic, Cellar, the Great Underground Empire (Troll Room, Flood Control Dam, Loud Room, etc.), the maze, Hades, and more
- Key items: brass lantern, elvish sword, jeweled egg, gold coffin, platinum bar, jade figurine, sapphire bracelet, trunk of jewels, crystal trident, etc.
- Key encounters: troll, thief, cyclops, spirits, vampire bat
- Puzzles work as they do in Zork: the dam, the coal mine, the Egyptian room, the mirror rooms, Hades, the maze, etc.
- Score increases when the player collects treasures and places them in the trophy case in the living room
- The brass lantern has limited battery life underground

VOICE-FIRST RESPONSE RULES:
- Describe rooms vividly but concisely — two to four sentences max
- For movement, describe the new room immediately
- For failed actions, give brief, witty responses in the Infocom style ("There is a wall in the way." or "You can't eat that.")
- Read inventory as a spoken list
- Announce score changes
- Keep the classic dry humor of Infocom games
- Never use visual formatting — no bullets, no bold, no lists with dashes
- Use "First... Then... Finally..." for sequences
- Use directional words naturally: "To the north you see..." not "N: forest"

COMMAND INTERPRETATION:
- Players speak naturally. Translate their voice into classic adventure commands
- "go north" / "head north" / "walk north" = north
- "pick up the sword" / "grab the sword" / "take sword" = take sword
- "what do I have" / "check my stuff" / "inventory" = inventory
- "where am I" / "look around" / "describe the room" = look
- "hit the troll" / "fight the troll" / "attack troll" = attack troll with sword
- "what's my score" = score
- Accept natural conversational commands and map them to game actions

Use the game_state tool to track inventory, location, score, and flags. Always update state when the player takes an item, moves rooms, or triggers an event. Check state before responding to ensure consistency.

ATMOSPHERE:
- Underground areas should feel dark and foreboding when the lantern is present, and terrifying in pitch blackness
- The thief should appear randomly and steal items
- The troll blocks the passage until defeated
- Convey a sense of mystery and danger
- Keep the wry, understated humor that made Infocom games legendary`,

  tools: {
    game_state: {
      description:
        "Read or update the current game state including inventory, room, score, and flags. Use action 'get' to read state, 'move' to change room, 'take' to add item to inventory, 'drop' to remove item, 'score' to add points, 'flag' to set a game flag, 'history' to log a command.",
      parameters: z.object({
        action: z.enum([
          "get",
          "move",
          "take",
          "drop",
          "score",
          "flag",
          "history",
        ]).describe("The state action to perform"),
        value: z.string().describe(
          "Room name for move, item name for take/drop, points for score, flag name for flag, command text for history",
        ).optional(),
      }),
      execute: (args, ctx) => {
        const { action, value } = args as { action: string; value?: string };
        const state = getOrCreateSession(ctx.sessionId);

        switch (action) {
          case "get":
            return {
              currentRoom: state.currentRoom,
              inventory: state.inventory,
              score: state.score,
              moves: state.moves,
              flags: state.flags,
              recentHistory: state.history.slice(-5),
            };

          case "move":
            if (value) {
              state.currentRoom = value;
              state.moves++;
            }
            return { currentRoom: state.currentRoom, moves: state.moves };

          case "take":
            if (value && !state.inventory.includes(value)) {
              state.inventory.push(value);
            }
            return { inventory: state.inventory };

          case "drop":
            if (value) {
              state.inventory = state.inventory.filter((i) => i !== value);
            }
            return { inventory: state.inventory };

          case "score":
            if (value) {
              state.score += parseInt(value) || 0;
            }
            return { score: state.score };

          case "flag":
            if (value) {
              state.flags[value] = true;
            }
            return { flags: state.flags };

          case "history":
            if (value) {
              state.history.push(value);
              state.moves++;
            }
            return {
              moves: state.moves,
              recentHistory: state.history.slice(-5),
            };

          default:
            return { error: "Unknown action" };
        }
      },
    },
  },

  onConnect: (ctx) => {
    getOrCreateSession(ctx.sessionId);
    console.log(`Adventurer ${ctx.sessionId} has entered the game`);
  },

  onDisconnect: (ctx) => {
    sessions.delete(ctx.sessionId);
    console.log(`Adventurer ${ctx.sessionId} has left the game`);
  },
});
