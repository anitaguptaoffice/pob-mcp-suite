/**
 * Tool Schemas
 *
 * Defines all MCP tool schemas for the PoB server.
 * These schemas describe the available tools, their parameters, and documentation.
 */

import type { ToolSchema } from './toolSchema.js';
export type { ToolSchema } from './toolSchema.js';

/**
 * Get all tool schemas for registration with the MCP server
 */
export function getToolSchemas(): ToolSchema[] {
  return [
    {
      name: "analyze_build",
      truncatable: true,
      description: "Analyze a Path of Building build file and extract detailed information including stats, skills, gear, passive skill tree analysis with keystones, notables, jewel sockets, build archetype detection, and optimization suggestions",
      inputSchema: {
        type: "object",
        properties: {
          build_name: {
            type: "string",
            description: "Name of the build file (e.g., 'MyBuild.xml')",
          },
        },
        required: ["build_name"],
      },
    },
    {
      name: "compare_builds",
      description: "Compare two Path of Building builds side by side",
      inputSchema: {
        type: "object",
        properties: {
          build1: {
            type: "string",
            description: "First build file name",
          },
          build2: {
            type: "string",
            description: "Second build file name",
          },
        },
        required: ["build1", "build2"],
      },
    },
    {
      name: "list_builds",
      description: "List all available Path of Building builds",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "get_build_stats",
      description: "Extract specific stats from a build (Life, DPS, resistances, etc.)",
      inputSchema: {
        type: "object",
        properties: {
          build_name: {
            type: "string",
            description: "Name of the build file",
          },
        },
        required: ["build_name"],
      },
    },
    {
      name: "start_watching",
      description: "Start monitoring the builds directory for changes. Builds will be auto-reloaded when saved in PoB.",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "stop_watching",
      description: "Stop monitoring the builds directory for changes.",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "get_recent_changes",
      description: "Get a list of recently changed build files.",
      inputSchema: {
        type: "object",
        properties: {
          limit: {
            type: "number",
            description: "Maximum number of recent changes to return (default: 10)",
          },
        },
      },
    },
    {
      name: "watch_status",
      description: "Check if file watching is currently enabled.",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "refresh_tree_data",
      description: "Force refresh the passive skill tree data cache. Use this if tree data seems outdated.",
      inputSchema: {
        type: "object",
        properties: {
          version: {
            type: "string",
            description: "Specific tree version to refresh (optional, defaults to all versions)",
          },
        },
      },
    },
    {
      name: "compare_trees",
      description: "Compare passive skill trees between two builds, showing differences in allocated nodes",
      inputSchema: {
        type: "object",
        properties: {
          build1: {
            type: "string",
            description: "First build file name",
          },
          build2: {
            type: "string",
            description: "Second build file name",
          },
        },
        required: ["build1", "build2"],
      },
    },
    {
      name: "get_nearby_nodes",
      description: "Find notable and keystone passives near your current tree allocation. Uses loaded Lua bridge build when no build_name is provided.",
      inputSchema: {
        type: "object",
        properties: {
          build_name: {
            type: "string",
            description: "Build file to analyze (optional if a build is loaded via lua_load_build)",
          },
          max_distance: {
            type: "number",
            description: "Maximum path distance to search (default: 5)",
          },
          filter: {
            type: "string",
            description: "Optional text filter for node names/stats",
          },
        },
      },
    },
    {
      name: "find_path_to_node",
      description: "Find the shortest path from your current tree to a specific passive node. Uses loaded Lua bridge build when no build_name is provided.",
      inputSchema: {
        type: "object",
        properties: {
          build_name: {
            type: "string",
            description: "Build to analyze (optional if a build is loaded via lua_load_build)",
          },
          target_node_id: {
            type: "string",
            description: "ID of the target passive node",
          },
        },
        required: ["target_node_id"],
      },
    },
    {
      name: "get_build_notes",
      description: "Read the notes/documentation from a PoB build file",
      inputSchema: {
        type: "object",
        properties: {
          build_name: { type: "string", description: "Name of the build file (e.g., 'MyBuild.xml')" },
        },
        required: ["build_name"],
      },
    },
    {
      name: "set_build_notes",
      description: "Write notes/documentation into a PoB build file (overwrites existing notes)",
      inputSchema: {
        type: "object",
        properties: {
          build_name: { type: "string", description: "Name of the build file" },
          notes: { type: "string", description: "Notes content to write (plain text or markdown)" },
        },
        required: ["build_name", "notes"],
      },
    },
    {
      name: "classify_item_affixes",
      description: "Classify supplied explicit modifier lines using PoB data, including hybrid affixes and ambiguous matches. Remaining slots are unknown unless rarity, complete explicit modifiers, and ordinary item capacity are confirmed and all lines are unambiguous. This does not validate the item or crafting legality.",
      inputSchema: {
        type: "object",
        properties: {
          mod_lines: {
            type: "array",
            items: { type: "string" },
            description: "The item's mod lines, one per entry, exactly as printed (e.g. '+42 to maximum Life'). PoB tags such as {crafted} are stripped automatically.",
          },
          rarity: { type: "string", enum: ["rare", "magic"], description: "Confirmed item rarity; required for slot counts." },
          explicit_mods_complete: { type: "boolean", description: "Set true only after confirming all explicit modifier lines are supplied. Does not validate item state or special rules." },
          ordinary_capacity_confirmed: { type: "boolean", description: "Set true only after confirming no special item rules change ordinary prefix or suffix capacity." },
        },
        required: ["mod_lines"],
      },
    },
    {
      name: "list_craftable_mods",
      description: "List the crafting bench mods an item class can take at a given item level, from Path of Building's ModMaster table. Use it to answer 'what can I put in the open suffix', and to say what a higher item level would unlock. A craft occupies a slot of its own type, so check the type of the affix being replaced, not only the one being added. LIMITS: bench crafts only, no essences, fossils or veiled mods, and no metacrafting. It does not know what the item already has, so pair it with classify_item_affixes.",
      inputSchema: {
        type: "object",
        properties: {
          item_class: {
            type: "string",
            description: "Item class as PoB names it: 'Body Armour', 'Helmet', 'Gloves', 'Boots', 'Shield', 'Ring', 'Amulet', 'Belt', 'Quiver', 'Wand', 'Bow', 'Staff', 'Sceptre', 'Dagger', 'Claw', 'One Handed Sword', and so on. A wrong value returns the full list of known classes.",
          },
          item_level: {
            type: "number",
            description: "The item's item level. Crafts requiring a higher level are reported separately rather than hidden.",
          },
          affix_type: {
            type: "string",
            enum: ["Prefix", "Suffix"],
            description: "Restrict to the slot type you actually have open.",
          },
          search: {
            type: "string",
            description: "Optional wording, affix name, group or mod tag filter (e.g. 'Cold Resistance', 'life').",
          },
        },
        required: ["item_class", "item_level"],
      },
    },
    {
      name: "find_affix_tiers",
      description: "Look up PoB affix tier data and positive-weight tags. slot_tags is a broad any-tag filter, not proof an item can roll a mod. A caller-confirmed complete item_tags set can evaluate the first matching base spawn rule; this does not account for multipliers, crafting mechanics, item state or mod conflicts and is not a probability.",
      inputSchema: {
        type: "object",
        properties: {
          search: {
            type: "string",
            description: "Stat wording, affix name, group or mod tag (e.g. 'Chaos Resistance', 'of Bameth', 'ChaosResistance').",
          },
          affix_type: {
            type: "string",
            enum: ["Prefix", "Suffix"],
            description: "Restrict to prefixes or suffixes.",
          },
          slot_tags: {
            type: "array",
            items: { type: "string" },
            description: "Broad filter: match any positive-weight tag; Elevated candidates may also match a zero-weight tag because PoB can override it for influence. This does not verify item eligibility.",
          },
          item_tags: { type: "array", items: { type: "string" }, description: "Complete independently verified item tag set including default; evaluates the first matching base spawn rule. Do not combine with slot_tags." },
          item_tags_complete: { type: "boolean", description: "Must be true when supplying item_tags; incomplete tags can yield a wrong rule." },
          max_item_level: {
            type: "number",
            description: "Drop tiers the item level cannot reach.",
          },
          include_unobtainable: {
            type: "boolean",
            description: "Include all zero-weight or non-matching base spawn rules; possible Elevated influence overrides remain candidates even when false. Zero base weight does not prove a modifier cannot be forced by a special mechanic. Default false.",
            default: false,
          },
          max_results: {
            type: "number",
            description: "Maximum affix groups to return (default 10).",
            default: 10,
          },
        },
        required: ["search"],
      },
    },
  ];
}

/**
 * Get Lua-specific tool schemas (only included if Lua is enabled)
 */
export function getLuaToolSchemas(): ToolSchema[] {
  return [
    {
      name: "inspect_item_affix_weight",
      description: "Use PoB's GetModSpawnWeight on a caller-provided item and PoB explicit modifier ID. Returns its item-data spawn weight and item-level context, not crafting probability or proof of eligibility. Requires a loaded PoB engine.",
      inputSchema: { type: "object", properties: {
        mod_id: { type: "string", description: "PoB explicit modifier ID, e.g. from find_affix_tiers." },
        item_text: { type: "string", description: "Complete PoB-compatible item text, up to 10 KB." },
      }, required: ["mod_id", "item_text"] },
    },
    {
      name: "compare_equipment_candidate",
      description: "Use the current live PoB build and item-preview calculator to compare one candidate item without equipping it. Returns player/minion damage and defense stats separately. Does not validate item legality or price; excludes jewels, flasks and swap slots.",
      inputSchema: { type: "object", properties: {
        slot: { type: "string", description: "Exact active PoB equipment slot, e.g. Amulet." },
        item_text: { type: "string", description: "Complete PoB-compatible item text, up to 10 KB." },
      }, required: ["slot", "item_text"] },
    },
    {
      name: "lua_get_capabilities",
      description: "Report the active PoB bridge mode, adapter version, and supported actions.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "lua_get_build_snapshot",
      description: "Get a compact, current-state summary after loading or editing a build: metadata, core live stats, passive-node count, equipped items, and main skill gems. Use detailed tools only when you need the underlying data.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "lua_start",
      description: "Start the PoB headless API process. This will spawn the LuaJIT process that can load builds and compute stats using the actual PoB calculation engine.",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "lua_stop",
      description: "Stop the PoB headless API process and clean up resources.",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "lua_new_build",
      description: "Create a new blank build with specified class and ascendancy. Auto-starts the Lua bridge if needed (no need to call lua_start first). Classes and ascendancies (PoE1): Scion: Ascendant | Marauder: Juggernaut, Berserker, Chieftain | Ranger: Raider, Deadeye, Pathfinder | Witch: Occultist, Elementalist, Necromancer | Duelist: Slayer, Gladiator, Champion | Templar: Inquisitor, Hierophant, Guardian | Shadow: Assassin, Trickster, Saboteur",
      inputSchema: {
        type: "object",
        properties: {
          class_name: { type: "string", description: "Class name (e.g., 'Witch', 'Marauder')" },
          ascendancy: { type: "string", description: "Ascendancy class name (optional)" },
        },
        required: ["class_name"],
      },
    },
    {
      name: "lua_save_build",
      description: "Save the currently loaded in-memory Lua bridge build atomically. Saving back to its source file is allowed; replacing another existing file requires overwrite=true. Required before using file-based tools (validate_build, analyze_build, etc.) on an in-memory build.",
      inputSchema: {
        type: "object",
        properties: {
          build_name: {
            type: "string",
            description: "Output filename (e.g., 'MyBuild.xml'). .xml extension added automatically if missing.",
          },
          overwrite: {
            type: "boolean",
            description: "Explicitly allow replacing a different existing build file (default: false).",
            default: false,
          },
        },
        required: ["build_name"],
      },
    },
    {
      name: "lua_load_build",
      description: "Load a build file into the PoB calculation engine. Required before using other lua_* tools. AUTO-RETURNS a brief summary (life, DPS, EHP, resistances, top issues) — do NOT immediately follow with lua_get_stats or get_build_issues just to get basic numbers. Call additional tools only when you need details beyond the summary.",
      inputSchema: {
        type: "object",
        properties: {
          build_name: {
            type: "string",
            description: "Name of the build file to load. Exactly one of build_name or build_xml must be provided.",
          },
          build_xml: {
            type: "string",
            description: "Raw PoB build XML to load directly instead of reading a file. Exactly one of build_name or build_xml must be provided.",
          },
          name: {
            type: "string",
            description: "Display name for the loaded build (optional; defaults to the build filename when build_name is used)",
          },
        },
      },
    },
    {
      name: "lua_import_code",
      description: "Import a compressed PoB build share code (the string generated by PoB's 'Generate' button) into the PoB calculation engine. Official passive-tree links and their uncompressed codes are not supported. AUTO-RETURNS a brief summary (life, DPS, EHP, resistances, top issues), same as lua_load_build. Follow up with lua_save_build to persist it to a file.",
      inputSchema: {
        type: "object",
        properties: {
          code: {
            type: "string",
            description: "The PoB import/export code to decode and load.",
          },
          name: {
            type: "string",
            description: "Display name for the imported build (optional; defaults to 'Imported Build').",
          },
        },
        required: ["code"],
      },
    },
    {
      name: "list_specs",
      description: "List all passive tree specs in the currently loaded build. Each spec can have a different tree allocation, class, and ascendancy.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "select_spec",
      description: "Switch the active passive tree spec in the currently loaded build. Recalculates all stats with the selected spec.",
      inputSchema: {
        type: "object",
        properties: {
          index: { type: "number", description: "Spec index (1-based, use list_specs to see available specs)" },
        },
        required: ["index"],
      },
    },
    {
      name: "create_spec",
      description: "Create a new passive tree spec in the currently loaded build, optionally copying an existing spec. Requires Lua bridge with a loaded build.",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string", description: "Title for the new spec (optional)" },
          copyFrom: { type: "number", description: "Spec index (1-based) to copy the tree allocation from (optional, use list_specs to see available specs)" },
          activate: { type: "boolean", description: "Make the new spec active immediately (default: false)" },
        },
      },
    },
    {
      name: "delete_spec",
      description: "Delete a passive tree spec from the currently loaded build. Requires Lua bridge with a loaded build.",
      inputSchema: {
        type: "object",
        properties: {
          index: { type: "number", description: "Spec index to delete (1-based, use list_specs to see available specs)" },
        },
        required: ["index"],
      },
    },
    {
      name: "rename_spec",
      description: "Rename a passive tree spec in the currently loaded build. Requires Lua bridge with a loaded build.",
      inputSchema: {
        type: "object",
        properties: {
          index: { type: "number", description: "Spec index to rename (1-based, use list_specs to see available specs)" },
          title: { type: "string", description: "New title for the spec" },
        },
        required: ["index", "title"],
      },
    },
    {
      name: "list_item_sets",
      description: "List all item sets in the currently loaded build. Each item set can have different gear equipped.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "select_item_set",
      description: "Switch the active item set in the currently loaded build. Recalculates all stats with the selected item set.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "number", description: "Item set ID (use list_item_sets to see available item sets)" },
        },
        required: ["id"],
      },
    },
    {
      name: "set_character_level",
      description: "Set the character level for the currently loaded build. Recalculates all stats.",
      inputSchema: {
        type: "object",
        properties: {
          level: {
            type: "number",
            description: "Character level (1-100)",
          },
        },
        required: ["level"],
      },
    },
    {
      name: "lua_get_ailments",
      description: "Show non-damaging ailments (Shock, Chill, Scorch, Brittle, Sap) with what the DPS calculation is actually crediting next to what the main skill would inflict on the configured enemy. Call this for any build that shocks or chills: PoB applies a chance-based ailment only when its magnitude is entered by hand, so an uncounted shock silently understates every DPS figure. Magnitude is measured for the MAIN skill against the CURRENT enemy config, and it falls off steeply with enemy life, so re-read it per enemy rather than quoting one number for all content.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "lua_get_stats",
      truncatable: true,
      description: "Get comprehensive calculated stats from the currently loaded build (requires lua_load_build first). Use category='offense' for DPS details, category='defense' for survivability, category='all' only when you need everything at once. Avoid calling multiple times with different categories — pick the right one.",
      inputSchema: {
        type: "object",
        properties: {
          category: {
            type: "string",
            description: "Stat category: 'offense', 'defense', 'all' (default: all)",
          },
        },
      },
    },
    {
      name: "lua_get_tree",
      truncatable: true,
      description: "Get passive tree allocation from currently loaded build",
      inputSchema: {
        type: "object",
        properties: {
          include_node_ids: {
            type: "boolean",
            description: "Include the full list of allocated node IDs in the response (default: false). Omit unless you need to pass node IDs to another tool.",
          },
        },
      },
    },
    {
      name: "lua_set_tree",
      description: "Set passive tree allocation (modifies currently loaded build). IMPORTANT: (1) All nodes must form a connected path from the class start node — any node not reachable through other allocated nodes back to the start will be silently dropped. Use find_path_to_node first to discover the intermediate travel nodes needed to reach your target. (2) Maximum 8 ascendancy points — do not allocate more than 8 ascendancy nodes (excluding the ascendancy start node).",
      inputSchema: {
        type: "object",
        properties: {
          nodes: {
            type: "array",
            items: { type: "string" },
            description: "Array of node IDs to allocate",
          },
          classId: {
            type: "number",
            description: "Class ID (0=Scion, 1=Marauder, 2=Ranger, 3=Witch, 4=Duelist, 5=Templar, 6=Shadow). If omitted, preserves current class.",
          },
          ascendClassId: {
            type: "number",
            description: "Ascendancy class ID (0=None, 1-3 class-specific). Scion: 1=Ascendant | Marauder: 1=Juggernaut, 2=Berserker, 3=Chieftain | Ranger: 1=Raider, 2=Deadeye, 3=Pathfinder | Witch: 1=Occultist, 2=Elementalist, 3=Necromancer | Duelist: 1=Slayer, 2=Gladiator, 3=Champion | Templar: 1=Inquisitor, 2=Hierophant, 3=Guardian | Shadow: 1=Assassin, 2=Trickster, 3=Saboteur",
          },
          masteryEffects: {
            type: "object",
            description: "Map of mastery node ID -> chosen effect ID (from get_mastery_options). A Mastery node with no effect selection is silently dropped by the tree import, so provide one entry per mastery node you want allocated. Existing mastery selections already on the build are preserved automatically and only need to be listed here if you want to change them.",
            additionalProperties: { type: "number" },
          },
        },
        required: ["nodes"],
      },
    },
    {
      name: "update_tree_delta",
      description: "Incrementally add or remove specific passive nodes from the current tree allocation. Automatically finds and includes intermediate path nodes when adding nodes that aren't directly adjacent to the current tree. Safer than lua_set_tree because you only specify the nodes to change, not the entire tree. Note: max 8 ascendancy points allowed.",
      inputSchema: {
        type: "object",
        properties: {
          add_nodes: {
            type: "array",
            items: { type: "string" },
            description: "Node IDs to add to the current allocation",
          },
          remove_nodes: {
            type: "array",
            items: { type: "string" },
            description: "Node IDs to remove from the current allocation",
          },
          mastery_effects: {
            type: "object",
            additionalProperties: { type: "number" },
            description: "Effect to select for each Mastery node being added, as {\"<nodeId>\": <effectId>}. Required to allocate a Mastery: Path of Building refuses to allocate a Mastery node that has no effect chosen. Use suggest_masteries or search_tree_nodes to find effect IDs.",
          },
        },
      },
    },
    {
      name: "lua_get_build_info",
      description: "Get metadata about the currently loaded build: name, character level, class, ascendancy, and tree version. Useful to confirm which build is active after lua_load_build or lua_new_build. Classes and ascendancies (PoE1): Scion: Ascendant | Marauder: Juggernaut, Berserker, Chieftain | Ranger: Raider, Deadeye, Pathfinder | Witch: Occultist, Elementalist, Necromancer | Duelist: Slayer, Gladiator, Champion | Templar: Inquisitor, Hierophant, Guardian | Shadow: Assassin, Trickster, Saboteur",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "lua_reload_build",
      description: "Reload the current build from disk, picking up any changes made in PoB GUI or via direct XML editing. If build_name is omitted, reloads the build that is currently loaded (determined via lua_get_build_info).",
      inputSchema: {
        type: "object",
        properties: {
          build_name: {
            type: "string",
            description: "Name of the build file to reload (e.g., 'MyBuild.xml'). If omitted, reloads the currently loaded build.",
          },
        },
      },
    },
    {
      name: "search_tree_nodes",
      description: "Search passive tree for nodes matching specific criteria",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search query for node names or stats",
          },
          node_type: {
            type: "string",
            description: "Filter by type: 'keystone', 'notable', 'jewel', or 'any' (default)",
          },
          limit: {
            type: "number",
            description: "Maximum results to return (default: 20)",
          },
          include_allocated: {
            type: "boolean",
            description: "Include nodes that are already allocated in the results (default: false)",
          },
        },
        required: ["query"],
      },
    },
    {
      name: "add_item",
      description: "Add an item to the build from item text (paste from game)",
      inputSchema: {
        type: "object",
        properties: {
          item_text: {
            type: "string",
            description: "Full item text from clipboard",
          },
          slot_name: {
            type: "string",
            description: "Optional exact PoB slot name, such as Weapon 1, Helmet, or Ring 2. Unknown or incompatible slots are rejected before adding the item. An explicit slot takes precedence over no_auto_equip.",
          },
          no_auto_equip: {
            type: "boolean",
            description: "Without slot_name, add the item without auto-equipping it (default: false).",
          },
        },
        required: ["item_text"],
      },
    },
    {
      name: "get_equipped_items",
      description: "Get all currently equipped items (empty slots are omitted). Returns name, base, rarity, and all mod lines (implicit, explicit, crafted, enchant) for each equipped item. Use when you need to evaluate gear choices or read specific affixes.",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "toggle_flask",
      description: "Toggle a flask on/off",
      inputSchema: {
        type: "object",
        properties: {
          flask_number: {
            type: "number",
            description: "Flask slot number (1-5)",
          },
          active: {
            type: "boolean",
            description: "true to activate, false to deactivate",
          },
        },
        required: ["flask_number", "active"],
      },
    },
    {
      name: "get_skill_setup",
      description: "Get current skill gem setup. Default main_only=true shows only the main DPS socket group — use this first. Set main_only=false only if you need to see all utility/aura/movement groups too.",
      inputSchema: {
        type: "object",
        properties: {
          main_only: {
            type: "boolean",
            description: "Only show the main socket group (default: true). Set to false to see all socket groups.",
          },
        },
      },
    },
    {
      name: "set_main_skill",
      description: "Set which skill group is the main skill for DPS calculations",
      inputSchema: {
        type: "object",
        properties: {
          group_index: {
            type: "number",
            description: "Socket group index (1-based)",
          },
          active_skill_index: {
            type: "number",
            description: "Active skill index within group (1-based, optional). Selects which active skill in the group to use for DPS calculation — relevant when a group has multiple active skills.",
          },
          skill_part: {
            type: "number",
            description: "Skill part index (1-based, optional). Selects which part of a multi-part skill to use for DPS calculation.",
          },
        },
        required: ["group_index"],
      },
    },
    {
      name: "create_socket_group",
      description: "Create a new socket group for skill gems",
      inputSchema: {
        type: "object",
        properties: {
          label: {
            type: "string",
            description: "Label for the socket group (e.g., 'Main Skill', 'Auras')",
          },
          slot: {
            type: "string",
            description: "Exact skill-group slot from the current PoB version, such as 'Weapon 1', 'Weapon 1 Swap', or 'Helmet'. Omit for an unattached group. Does not validate equipped item sockets.",
          },
          enabled: {
            type: "boolean",
            description: "Whether group is enabled (default: true)",
          },
          include_in_full_dps: {
            type: "boolean",
            description: "Include this group's skills in Full DPS totals (default: false)",
          },
        },
      },
    },
    {
      name: "add_gem",
      description: "Add a gem to a socket group. IMPORTANT: Use the gem's base name WITHOUT 'Support' suffix — e.g. 'Brutality' not 'Brutality Support', 'Concentrated Effect' not 'Concentrated Effect Support', 'Melee Physical Damage' not 'Melee Physical Damage Support'. The server will auto-resolve names but correct names ensure proper matching.",
      inputSchema: {
        type: "object",
        properties: {
          group_index: {
            type: "number",
            description: "Socket group index (1-based)",
          },
          gem_name: {
            type: "string",
            description: "Gem name WITHOUT 'Support' suffix (e.g. 'Brutality', 'Concentrated Effect', 'Multistrike')",
          },
          level: {
            type: "number",
            description: "PoB simulation level, integer 1-40 (default: 20). This does not verify in-game availability.",
          },
          quality: {
            type: "number",
            description: "PoB simulation quality, integer 0-99 (default: 0). This does not verify in-game availability.",
          },
          quality_type: {
            type: "string",
            description: "Only 'Default' is verified for this PoB adapter; omitted means Default.",
          },
          enabled: {
            type: "boolean",
            description: "Whether gem is enabled (default: true)",
          },
        },
        required: ["group_index", "gem_name"],
      },
    },
    {
      name: "set_gem_level",
      description: "Set the level of a gem",
      inputSchema: {
        type: "object",
        properties: {
          group_index: {
            type: "number",
            description: "Socket group index (1-based)",
          },
          gem_index: {
            type: "number",
            description: "Gem index within group (1-based)",
          },
          level: {
            type: "number",
            description: "New gem level",
          },
        },
        required: ["group_index", "gem_index", "level"],
      },
    },
    {
      name: "set_gem_quality",
      description: "Set the quality of a gem",
      inputSchema: {
        type: "object",
        properties: {
          group_index: {
            type: "number",
            description: "Socket group index (1-based)",
          },
          gem_index: {
            type: "number",
            description: "Gem index within group (1-based)",
          },
          quality: {
            type: "number",
            description: "PoB simulation quality, integer 0-99. This does not verify in-game availability.",
          },
          quality_type: {
            type: "string",
            description: "Only 'Default' is verified for this PoB adapter; omit to leave any existing field unchanged.",
          },
        },
        required: ["group_index", "gem_index", "quality"],
      },
    },
    {
      name: "remove_skill",
      description: "Remove an entire socket group",
      inputSchema: {
        type: "object",
        properties: {
          group_index: {
            type: "number",
            description: "Socket group index to remove (1-based)",
          },
        },
        required: ["group_index"],
      },
    },
    {
      name: "remove_gem",
      description: "Remove a specific gem from a socket group",
      inputSchema: {
        type: "object",
        properties: {
          group_index: {
            type: "number",
            description: "Socket group index (1-based)",
          },
          gem_index: {
            type: "number",
            description: "Gem index to remove (1-based)",
          },
        },
        required: ["group_index", "gem_index"],
      },
    },
    {
      name: "toggle_socket_group",
      description: "Enable or disable an entire socket group. Stats are recalculated. Requires Lua bridge with a loaded build.",
      inputSchema: {
        type: "object",
        properties: {
          group_index: {
            type: "number",
            description: "Socket group index (1-based)",
          },
          enabled: {
            type: "boolean",
            description: "true to enable the group, false to disable it",
          },
        },
        required: ["group_index", "enabled"],
      },
    },
    {
      name: "toggle_gem",
      description: "Enable or disable a single gem within a socket group. Stats are recalculated. Requires Lua bridge with a loaded build.",
      inputSchema: {
        type: "object",
        properties: {
          group_index: {
            type: "number",
            description: "Socket group index (1-based)",
          },
          gem_index: {
            type: "number",
            description: "Gem index within group (1-based)",
          },
          enabled: {
            type: "boolean",
            description: "true to enable the gem, false to disable it",
          },
        },
        required: ["group_index", "gem_index", "enabled"],
      },
    },
    {
      name: "setup_skill_with_gems",
      description: "Create a socket group and add gems sequentially. On failure the response reports the created group, completed gems and unattempted gems; it is not atomic. Does not verify support application, socket capacity or item legality, and does not select the main skill.",
      inputSchema: {
        type: "object",
        properties: {
          label: {
            type: "string",
            description: "Label for skill group",
          },
          active_gem: {
            type: "string",
            description: "Active skill gem name",
          },
          support_gems: {
            type: "array",
            items: { type: "string" },
            description: "Array of support gem names",
          },
          slot: {
            type: "string",
            description: "Optional exact skill-group slot from the current PoB version.",
          },
          enabled: {
            type: "boolean",
            description: "Whether the new group is enabled (default: true)",
          },
          include_in_full_dps: {
            type: "boolean",
            description: "Include this group's skills in Full DPS totals (default: false)",
          },
        },
        required: ["label", "active_gem", "support_gems"],
      },
    },
    {
      name: "add_multiple_items",
      description: "Add items sequentially. Input format is checked first; if an item fails, execution stops and reports completed items and unattempted items. This operation is not atomic; inspect the build before retrying.",
      inputSchema: {
        type: "object",
        properties: {
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                item_text: { type: "string" },
                slot_name: { type: "string" },
              },
              required: ["item_text"],
            },
            description: "Array of items to add",
          },
        },
        required: ["items"],
      },
    },
    {
      name: "plan_leveling",
      truncatable: true,
      description: "Generate an act-by-act leveling progression guide for a build, including skill gem progression, lab timing, and passive tree priority order",
      inputSchema: {
        type: "object",
        properties: {
          build_name: { type: "string", description: "Build file to read class/skill from (optional if build loaded in Lua bridge)" },
          class_name: { type: "string", description: "Override class name (e.g. 'Witch', 'Ranger')" },
          main_skill: { type: "string", description: "Override main skill name" },
          ascendancy: { type: "string", description: "Override ascendancy name" },
        },
      },
    },
    {
      name: "find_item_upgrades",
      truncatable: true,
      description: "Show available live PoB equipment and defensive stats for a slot as context for choosing a candidate. Does not recommend a verified item, calculate replacement gains, or check prices. No trade API required.",
      inputSchema: {
        type: "object",
        properties: {
          slot: {
            type: "string",
            description: "Gear slot to get a shopping spec for (e.g., 'Helmet', 'Body Armour', 'Boots', 'Gloves', 'Belt', 'Amulet', 'Ring 1', 'Ring 2', 'Weapon 1', 'Weapon 2')",
          },
          priority: {
            type: "string",
            description: "What to optimize for: 'dps', 'defense', 'resistance', or 'balanced' (default: 'balanced')",
            enum: ["dps", "defense", "resistance", "balanced"],
          },
        },
        required: ["slot"],
      },
    },
  ];
}

/**
 * Get optimization tool schemas
 */
export function getOptimizationToolSchemas(): ToolSchema[] {
  return [
    {
      name: "analyze_defenses",
      truncatable: true,
      description: "Deep-dive into defensive layers (avoidance/mitigation/recovery): EHP, spell suppression, evasion, block, armour/PDR, life regen, leech. Use this when you specifically want detailed defense breakdown. validate_build already covers this — only call analyze_defenses separately if you need more defensive detail than validate_build provides.",
      inputSchema: {
        type: "object",
        properties: {
          build_name: {
            type: "string",
            description: "Build to analyze",
          },
        },
        required: ["build_name"],
      },
    },
    {
      name: "suggest_optimal_nodes",
      truncatable: true,
      description: "Heuristic search for passive nodes matching build goals; does not calculate gains, confirm reachability, or guarantee optimal nodes.",
      inputSchema: {
        type: "object",
        properties: {
          build_name: {
            type: "string",
            description: "Build to optimize",
          },
          goal: {
            type: "string",
            description: "Optimization goal: 'damage', 'defense', 'life', 'es', or stat name",
          },
          points_available: {
            type: "number",
            description: "Number of passive points to spend (default: 10)",
          },
        },
        required: ["build_name", "goal"],
      },
    },
    {
      name: "optimize_tree",
      truncatable: true,
      description: "Suggest nearby passive nodes using the active tree and version. Does not reallocate nodes, recalculate gains, or guarantee an optimal tree.",
      inputSchema: {
        type: "object",
        properties: {
          build_name: {
            type: "string",
            description: "Build to optimize",
          },
          goal: {
            type: "string",
            description: "Primary optimization goal: 'damage', 'defense', 'balanced'",
          },
          constraints: {
            type: "object",
            description: "Optional constraints: { minLife, minES, protectedNodes: string[] }. protectedNodes are excluded from recommendations; minLife/minES are evaluated against current stats and reported (suggestions are not stat-recalculated).",
          },
          max_points: {
            type: "number",
            description: "Number of passive points to optimize; caps how many recommended allocations are returned (default: 10)",
          },
          max_iterations: {
            type: "number",
            description: "Maximum optimization iterations (accepted for forward compatibility; not used by the current analyzer)",
          },
        },
        required: ["build_name", "goal"],
      },
    },
    {
      name: "analyze_items",
      truncatable: true,
      description: "Analyze equipped items and suggest upgrades or improvements",
      inputSchema: {
        type: "object",
        properties: {
          build_name: {
            type: "string",
            description: "Build to analyze",
          },
        },
        required: ["build_name"],
      },
    },
    {
      name: "optimize_skill_links",
      truncatable: true,
      description: "Inspect skill groups and enabled gems using PoB gem types. Does not verify support compatibility or estimate damage; use PoB calculations for comparisons.",
      inputSchema: {
        type: "object",
        properties: {
          build_name: {
            type: "string",
            description: "Build to analyze",
          },
        },
        required: ["build_name"],
      },
    },
    {
      name: "create_budget_build",
      truncatable: true,
      description: "Create a league-start/budget-friendly version of a build",
      inputSchema: {
        type: "object",
        properties: {
          build_name: {
            type: "string",
            description: "Build to create budget version of",
          },
          budget_tier: {
            type: "string",
            description: "Budget tier: 'league-start', 'low', 'medium' (default: league-start)",
          },
        },
        required: ["build_name"],
      },
    },
  ];
}

/**
 * Get configuration tool schemas (Phase 9)
 */
export function getConfigToolSchemas(): ToolSchema[] {
  return [
    {
      name: "get_config",
      description: "View current configuration state including charge usage, enemy settings, and active conditions. Requires Lua bridge with a loaded build.",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "set_config",
      description: "Modify configuration inputs. Common keys — Charges: usePowerCharges, useFrenzyCharges, useEnduranceCharges | Conditions: buffFortification, conditionLeeching, conditionFullLife, conditionFullEnergyShield | Buffs: buffOnslaught | Enemy: enemyIsBoss ('None'/'Boss'/'Pinnacle'/'Uber'; legacy names 'Shaper'/'Sirus' map to 'Pinnacle', 'Atziri'/'Uber Atziri' to 'Boss'), enemyLevel | Build: bandit ('None'/'Oak'/'Alira'/'Kraityn'), pantheonMajorGod, pantheonMinorGod. Values outside an option's accepted set are rejected per key, never silently ignored. Call get_config to see all current values.",
      inputSchema: {
        type: "object",
        properties: {
          config_name: {
            type: "string",
            description: "Name of configuration input to change (e.g., 'usePowerCharges', 'enemyIsBoss', 'buffFortification')",
          },
          value: {
            description: "New value (boolean for most flags, number for counts)",
          },
        },
        required: ["config_name", "value"],
      },
    },
    {
      name: "set_enemy_stats",
      description: "Configure enemy parameters for DPS calculations. Test against different enemy types (map boss, Shaper, Maven). Requires Lua bridge.",
      inputSchema: {
        type: "object",
        properties: {
          level: {
            type: "number",
            description: "Enemy level (default: 84)",
          },
          fire_resist: {
            type: "number",
            description: "Fire resistance % (default: 40)",
          },
          cold_resist: {
            type: "number",
            description: "Cold resistance % (default: 40)",
          },
          lightning_resist: {
            type: "number",
            description: "Lightning resistance % (default: 40)",
          },
          chaos_resist: {
            type: "number",
            description: "Chaos resistance % (default: 20)",
          },
          armor: {
            type: "number",
            description: "Enemy armor value",
          },
          evasion: {
            type: "number",
            description: "Enemy evasion value",
          },
        },
      },
    },
    {
      name: "save_config_preset",
      description: "Save the current configuration (charges, conditions, enemy settings) as a named preset for quick reuse",
      inputSchema: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Preset name (e.g. 'bossing', 'mapping', 'full-charges')",
          },
        },
        required: ["name"],
      },
    },
    {
      name: "load_config_preset",
      description: "Load a previously saved configuration preset, restoring all charge, condition, and enemy settings at once",
      inputSchema: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Preset name to load",
          },
        },
        required: ["name"],
      },
    },
    {
      name: "list_config_presets",
      description: "List all saved configuration presets",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
  ];
}

/**
 * Get build validation tool schemas (Phase 7)
 */
export function getValidationToolSchemas(): ToolSchema[] {
  return [
    {
      name: "validate_build",
      truncatable: true,
      description: "Comprehensive build validation: resistances, life pool, defensive layers (avoidance/mitigation/recovery), mana sustain, accuracy, flask immunities, damage scaling. Provides prioritized critical/warning/info recommendations. PREFER this over get_build_issues + analyze_defenses — it covers both in one call. Do not call all three.",
      inputSchema: {
        type: "object",
        properties: {
          build_name: {
            type: "string",
            description: "Build to validate. If omitted and Lua bridge is active, validates currently loaded build.",
          },
        },
      },
    },
  ];
}

/**
 * Get skill gem analysis tool schemas (Phase 11)
 */
export function getSkillGemToolSchemas(): ToolSchema[] {
  return [
    {
      name: "analyze_skill_links",
      truncatable: true,
      description: "Inspect the selected saved skill group and gem status. Does not rate support compatibility or calculate damage.",
      inputSchema: {
        type: "object",
        properties: {
          build_name: {
            type: "string",
            description: "Build to analyze",
          },
          skill_index: {
            type: "number",
            description: "Zero-based socket group index; omit to use the saved main group.",
          },
        },
        required: ["build_name"],
      },
    },
    {
      name: "suggest_support_gems",
      truncatable: true,
      description: "List supports compatible with the selected skill according to PoB. Results are alphabetical, not ranked by damage or price; compare candidates with compare_gem_setups.",
      inputSchema: {
        type: "object",
        properties: {
          build_name: {
            type: "string",
            description: "Build to analyze",
          },
          skill_index: {
            type: "number",
            description: "Zero-based socket group index; omit to use the saved main group.",
          },
          count: {
            type: "number",
            description: "Maximum candidates to return, 1–100 (default 25).",
          },
          include_exceptional: {
            type: "boolean",
            description: "Include exceptional support candidates (default true).",
          },
          query: {
            type: "string",
            description: "Optional case-insensitive name substring; use PoB gem names.",
          },
          budget: {
            type: "string",
            description: "Accepted for compatibility; market price filtering is unavailable.",
          },
        },
        required: ["build_name"],
      },
    },
    {
      name: "compare_gem_setups",
      truncatable: true,
      description: "Compare 2–5 complete gem setups in an isolated PoB engine using the saved main skill group. Each setup must include the existing active gem. New supports default to level 20 and 0% quality. Reports player and minion DPS metrics separately.",
      inputSchema: {
        type: "object",
        properties: {
          build_name: {
            type: "string",
            description: "Build to test",
          },
          skill_index: {
            type: "number",
            description: "Zero-based socket group index; omit to use the saved main group. Other groups are not yet supported.",
          },
          setups: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                gems: {
                  type: "array",
                  items: { type: "string" },
                },
                gem_overrides: {
                  type: "object",
                  description: "Optional map from a listed gem name to {level, quality}; integer level 1-40 and quality 0-99. Overrides are simulation inputs and do not establish in-game availability.",
                  additionalProperties: { type: "object", properties: { level: { type: "number" }, quality: { type: "number" } } },
                },
              },
              required: ["name", "gems"],
            },
            description: "2–5 complete gem setups; each must contain the saved active gem and at most five supports. Use PoB gem names without the Support suffix.",
          },
        },
        required: ["build_name", "setups"],
      },
    },
    {
      name: "rank_support_gems",
      truncatable: true,
      description: "Use an isolated PoB engine to compare 1–4 explicitly named support replacements in the saved main skill group. Only candidates PoB confirms as applying are ranked. This does not search every gem or estimate cost.",
      inputSchema: { type: "object", properties: {
        build_name: { type: "string", description: "Saved build file." },
        replace_gem: { type: "string", description: "Name of an enabled support in the saved main group." },
        candidates: { type: "array", items: { type: "string" }, description: "1–4 distinct PoB support gem names without the Support suffix." },
        damage_metric: { type: "string", enum: ["CombinedDPS", "TotalDPS", "MinionCombinedDPS", "MinionTotalDPS"], description: "Optional metric; required when player and minion damage are both positive or the choice is unclear." },
      }, required: ["build_name", "replace_gem", "candidates"] },
    },
    {
      name: "validate_gem_quality",
      description: "List saved gem levels and qualities. Does not infer quality benefit, corruption state, or upgrade priority.",
      inputSchema: {
        type: "object",
        properties: {
          build_name: {
            type: "string",
            description: "Build to validate",
          },
          include_corrupted: {
            type: "boolean",
            description: "If true, explain that corruption status and probabilities are not inferred.",
          },
        },
        required: ["build_name"],
      },
    },
    {
      name: "find_optimal_links",
      truncatable: true,
      description: "Inspect the saved skill group; automatic optimal-link search and budget calculation are unavailable. Compare explicit candidates with compare_gem_setups.",
      inputSchema: {
        type: "object",
        properties: {
          build_name: {
            type: "string",
            description: "Build to optimize",
          },
          skill_index: {
            type: "number",
            description: "Zero-based socket group index; omit to use the saved main group.",
          },
          link_count: {
            type: "number",
            description: "Number of links (4, 5, or 6)",
          },
          budget: {
            type: "string",
            description: "Accepted for compatibility; market price filtering is unavailable.",
          },
        },
        required: ["build_name", "link_count"],
      },
    },
    {
      name: "gem_upgrade_path",
      description: "Inspect enabled gems in the requested build. Does not estimate damage, market prices, or corruption odds; verify upgrades with PoB and current trade data.",
      inputSchema: {
        type: "object",
        properties: {
          build_name: {
            type: "string",
            description: "Build file (optional if loaded in Lua bridge)",
          },
          budget: {
            type: "string",
            description: "Budget tier: 'league_start', 'mid_league', 'endgame' (default: endgame)",
          },
        },
      },
    },
  ];
}

/**
 * Get export and persistence tool schemas (Phase 8)
 */
export function getExportToolSchemas(): ToolSchema[] {
  return [
    {
      name: "export_build",
      description: "Export a copy of a build to an XML file. Creates a variant/copy from an existing build file. NOTE: This does NOT export from Lua bridge - use save_tree to apply Lua bridge modifications back to files.",
      inputSchema: {
        type: "object",
        properties: {
          build_name: {
            type: "string",
            description: "Source build filename (e.g., 'MyBuild.xml')",
          },
          output_name: {
            type: "string",
            description: "Output filename (without .xml extension)",
          },
          output_directory: {
            type: "string",
            description: "Sub-directory under POB_DIRECTORY to export into (optional, defaults to POB_DIRECTORY/.pob-mcp/exports). Paths outside POB_DIRECTORY are rejected.",
          },
          overwrite: {
            type: "boolean",
            description: "Allow overwriting existing file (default: false)",
          },
          notes: {
            type: "string",
            description: "Additional notes to append to build notes",
          },
        },
        required: ["build_name", "output_name"],
      },
    },
    {
      name: "save_tree",
      description: "Update only the passive tree in an existing build file. Use this to apply tree optimizations or Lua bridge modifications back to the original build.",
      inputSchema: {
        type: "object",
        properties: {
          build_name: {
            type: "string",
            description: "Target build filename to update",
          },
          nodes: {
            type: "array",
            items: { type: "string" },
            description: "Array of node IDs to allocate",
          },
          mastery_effects: {
            type: "object",
            description: "Mastery selections as object mapping node ID to effect ID (optional)",
          },
          backup: {
            type: "boolean",
            description: "Create backup before modifying (default: true)",
          },
        },
        required: ["build_name", "nodes"],
      },
    },
    {
      name: "snapshot_build",
      description: "Create a versioned snapshot of a build for easy rollback. Snapshots are stored separately with metadata tracking stats and changes.",
      inputSchema: {
        type: "object",
        properties: {
          build_name: {
            type: "string",
            description: "Build to snapshot",
          },
          description: {
            type: "string",
            description: "Description of this snapshot (optional)",
          },
          tag: {
            type: "string",
            description: "User-friendly tag (e.g., 'before-respec', 'league-start') (optional)",
          },
        },
        required: ["build_name"],
      },
    },
    {
      name: "list_snapshots",
      description: "List all snapshots for a build with metadata and stats",
      inputSchema: {
        type: "object",
        properties: {
          build_name: {
            type: "string",
            description: "Build to list snapshots for",
          },
          limit: {
            type: "number",
            description: "Maximum number of snapshots to return (optional)",
          },
          tag_filter: {
            type: "string",
            description: "Filter by tag (optional)",
          },
        },
        required: ["build_name"],
      },
    },
    {
      name: "restore_snapshot",
      description: "Restore a build from a snapshot. Optionally creates a backup of current state before restoring.",
      inputSchema: {
        type: "object",
        properties: {
          build_name: {
            type: "string",
            description: "Build to restore",
          },
          snapshot_id: {
            type: "string",
            description: "Snapshot ID (timestamp) or tag to restore from",
          },
          backup_current: {
            type: "boolean",
            description: "Create snapshot of current state before restore (default: true)",
          },
        },
        required: ["build_name", "snapshot_id"],
      },
    },
    {
      name: "export_build_summary",
      description: "Generate a Simplified Chinese Markdown report of the loaded build, including PoB stats, skills, equipment, tree and raw configuration. Original game names and configuration keys are retained; missing data is explicitly marked.",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
  ];
}

/**
 * Get Trade API tool schemas (require POE_TRADE_ENABLED=true)
 */
export function getTradeToolSchemas(): ToolSchema[] {
  return [
    {
      name: "compare_trade_listings_in_pob",
      description: "Fetch up to five official trade listings and preview them sequentially in an isolated PoB engine using one captured live-build snapshot. Rejects candidate results if numeric snapshot baselines do not match. Returns per-item failures without ranking or currency conversion. Requires Trade API and Lua bridge.",
      inputSchema: { type: "object", properties: {
        league: { type: "string", description: "Exact international league of the original search." },
        slot: { type: "string", description: "Exact active PoB equipment slot." },
        item_ids: { type: "array", items: { type: "string" }, description: "One to five distinct listing IDs from the same search." },
        search_id: { type: "string", description: "Official query ID from the same search." },
      }, required: ["league", "slot", "item_ids", "search_id"] },
    },
    {
      name: "compare_trade_listing_in_pob",
      description: "Fetch one official international trade listing and preview its exact official clipboard text in the current PoB build. Requires Trade API and Lua bridge. Does not verify listing availability, search status, item legality or price freshness.",
      inputSchema: { type: "object", properties: {
        league: { type: "string", description: "Exact international league of the original search." },
        slot: { type: "string", description: "Exact active PoB equipment slot." },
        item_id: { type: "string", description: "Official listing ID from the original search." },
        search_id: { type: "string", description: "Official query ID from the same search." },
      }, required: ["league", "slot", "item_id", "search_id"] },
    },
    {
      name: "find_weighted_trade_items",
      description: "Find instant-buyout candidates using upstream PoB TradeQueryGenerator stat weights. Candidates are not verified best-in-slot or individually simulated. Requires a loaded build, POE_TRADE_ENABLED=true, and POE_SESSION_ID.",
      inputSchema: { type: "object", properties: { league: { type: "string" }, slot: { type: "string" }, options: { type: "object" }, limit: { type: "number" } }, required: ["league", "slot"] },
    },
    {
      name: "search_trade_items",
      truncatable: true,
      description: "Search official Path of Exile trade listings. Defaults to securable instant-buyout listings; explicit status and legacy online_only options override this. Returns raw listing data in official search order, not calculated build benefit. REQUIRES: POE_TRADE_ENABLED=true.",
      inputSchema: {
        type: "object",
        properties: {
          league: {
            type: "string",
            description: "EXACT league name as specified by user (e.g., 'Standard', 'Settlers', 'Keepers', 'Hardcore'). Use get_leagues to see available leagues. Do not substitute or change the league name.",
          },
          item_name: {
            type: "string",
            description: "Specific item name to search for (e.g., 'Headhunter', 'Taste of Hate')",
          },
          item_type: {
            type: "string",
            description: "Base item type (e.g., 'Corsair Sword', 'Astral Plate')",
          },
          min_price: {
            type: "number",
            description: "Minimum price in the specified currency",
          },
          max_price: {
            type: "number",
            description: "Maximum price in the specified currency",
          },
          price_currency: {
            type: "string",
            description: "Currency for price filter (default: 'chaos'). Options: 'chaos', 'divine', 'exalted'",
          },
          status: {
            type: "string",
            description: "Official trade listing status; defaults to securable when no legacy online_only option is supplied. Overrides online_only when provided.",
            enum: ["available", "securable", "online", "onlineleague", "any"],
          },
          item_rarity: {
            type: "string",
            description: "Item rarity filter: 'unique', 'rare', 'magic', 'normal'",
            enum: ["unique", "rare", "magic", "normal", "any"],
          },
          online_only: {
            type: "boolean",
            description: "Legacy option: true selects available (instant buyout or in-person); false selects any. Use status for an exact filter.",
          },
          min_links: {
            type: "number",
            description: "Minimum number of links (for weapons/armor)",
          },
          corrupted: {
            type: "boolean",
            description: "Filter by corruption status (true/false/undefined for any)",
          },
          identified: {
            type: "boolean",
            description: "Filter by identification status",
          },
          online_status: {
            type: "string",
            enum: ["available", "online", "onlineleague", "securable", "any"],
            description: "Legacy online-status filter; when omitted, defaults to securable unless online_only is explicitly supplied.",
          },
          mods: {
            type: "array",
            items: {
              type: "object",
              properties: {
                stat_id: { type: "string" },
                min: { type: "number" },
                max: { type: "number" },
              },
              required: ["stat_id"],
            },
            description: "Legacy flat list of stat filters. All entries are joined with AND. Use stat_groups for source alternatives or other boolean logic.",
          },
          stat_groups: {
            type: "array",
            items: {
              type: "object",
              properties: {
                type: {
                  type: "string",
                  enum: ["and", "or", "not", "count", "weight"],
                  description: "Boolean/stat aggregation mode for this independent requirement group",
                },
                min: {
                  type: "number",
                  description: "Minimum number of matching filters for count groups, or minimum total for weight groups",
                },
                max: {
                  type: "number",
                  description: "Optional maximum match/weight value",
                },
                filters: {
                  type: "array",
                  minItems: 1,
                  items: {
                    type: "object",
                    properties: {
                      stat_id: { type: "string" },
                      min: { type: "number" },
                      max: { type: "number" },
                    },
                    required: ["stat_id"],
                  },
                },
              },
              required: ["type", "filters"],
            },
            description: "Independent stat groups. For one requirement that may come from Explicit or Fractured, use a count group with min=1 and both stat IDs. Put each mandatory semantic requirement in its own group.",
          },
          audit_sources: {
            type: "boolean",
            description: "Warn when a non-unique item search uses Explicit stats while official data exposes omitted source variants (default: true)",
          },
          limit: {
            type: "number",
            description: "Maximum results (default: 5, max: 10)",
            minimum: 1,
            maximum: 10,
          },
          sort: {
            type: "string",
            description: "Sort results by listing price",
            enum: ["price_asc", "price_desc"],
          },
        },
        required: ["league"],
      },
    },
    {
      name: "get_item_price",
      description: "Sample up to 10 priced instant-buyout listings for an exact item name and international league. Results are asking prices, not sales or a full-market median.",
      inputSchema: {
        type: "object",
        properties: {
          item_name: {
            type: "string",
            description: "Name of the item to price check",
          },
          league: {
            type: "string",
            description: "EXACT league name as specified by user",
          },
          item_type: {
            type: "string",
            description: "Item base type for more accurate results (optional)",
          },
          rarity: {
            type: "string",
            description: "Item rarity: 'unique', 'rare', 'magic', 'normal' (optional)",
            enum: ["unique", "rare", "magic", "normal"],
          },
        },
        required: ["item_name", "league"],
      },
    },
    {
      name: "get_leagues",
      description: "Get list of currently active Path of Exile leagues. Use this to find the correct league name before searching trade or prices. REQUIRES: POE_TRADE_ENABLED environment variable set to true.",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "search_stats",
      description: "Search for item stat/mod IDs to use in trade searches. Use this to find the correct stat_id values for mods you want to filter by. REQUIRES: POE_TRADE_ENABLED environment variable set to true.",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search query for stat names (e.g., 'life', 'fire resistance')",
          },
          limit: {
            type: "number",
            description: "Maximum results to return (default: 10)",
          },
          official_sources: {
            type: "boolean",
            description: "Return source-specific IDs from the official stat API, grouped by identical stat text (default: true)",
          },
        },
        required: ["query"],
      },
    },
    {
      name: "compare_trade_items",
      truncatable: true,
      description: "Show raw trade listing details side by side. Does not calculate DPS, defenses, price conversions, or build-specific value. REQUIRES: POE_TRADE_ENABLED=true.",
      inputSchema: {
        type: "object",
        properties: {
          item_ids: {
            type: "array",
            items: { type: "string" },
            description: "Listing ids to compare, from a prior search_trade_items result",
          },
          search_id: {
            type: "string",
            description: "The search id from the same search_trade_items result. Provides the query context expected by the trade fetch endpoint.",
          },
          build_context: {
            type: "object",
            description: "Legacy input retained for compatibility; it is not used to calculate a score or replacement benefit.",
            properties: {
              life_needed: { type: "number" },
              es_needed: { type: "number" },
              dps_target: { type: "number" },
              fire_resist_needed: { type: "number" },
              cold_resist_needed: { type: "number" },
              lightning_resist_needed: { type: "number" },
            },
          },
        },
        required: ["item_ids"],
      },
    },
    {
      name: "find_resistance_gear",
      truncatable: true,
      description: "Find individual instant-buyout listings with relevant resistances within a per-item budget. Does not evaluate replacement losses or enforce a combined budget. REQUIRES: POE_TRADE_ENABLED=true.",
      inputSchema: {
        type: "object",
        properties: {
          league: { type: "string", description: "Exact league name; use get_leagues when needed." },
          fire_resist_needed: { type: "number", description: "Additional fire resistance needed (default: 0)." },
          cold_resist_needed: { type: "number", description: "Additional cold resistance needed (default: 0)." },
          lightning_resist_needed: { type: "number", description: "Additional lightning resistance needed (default: 0)." },
          chaos_resist_needed: { type: "number", description: "Additional chaos resistance needed (default: 0)." },
          max_price_per_item: { type: "number", description: "Maximum price for a single item (default: 50)." },
          total_budget: { type: "number", description: "Caps each individual item, but combinations and their combined budget are not calculated." },
          currency: { type: "string", description: "Budget currency (default: chaos)." },
          slots: { type: "array", items: { type: "string" }, description: "Optional slots to search, such as Ring 1, Belt, Boots, or Gloves." },
          limit: { type: "number", description: "Maximum recommendations (default: 8)." },
        },
        required: ["league"],
      },
    },
    {
      name: "search_cluster_jewels",
      truncatable: true,
      description: "Search securable cluster jewel listings. Enchant and exact notable names are filtered locally from at most 30 listings, so results are incomplete and the trade link represents only the broader search. REQUIRES: POE_TRADE_ENABLED=true.",
      inputSchema: {
        type: "object",
        properties: {
          league: {
            type: "string",
            description: "EXACT league name as specified by user",
          },
          jewel_size: {
            type: "string",
            description: "Cluster jewel size: 'large', 'medium', or 'small'",
            enum: ["large", "medium", "small"],
          },
          passive_count: {
            type: "number",
            description: "Exact number of added passive skills; searches the official enchant and explicit variants as alternatives.",
          },
          min_item_level: {
            type: "number",
            description: "Minimum item level.",
          },
          enchant: {
            type: "string",
            description: "Enchant modifier name (e.g., 'Added Small Passive Skills grant: 10% increased Fire Damage')",
          },
          notables: {
            type: "array",
            items: { type: "string" },
            description: "Notable passives to search for (e.g., ['Doryani\\'s Lesson', 'Prismatic Heart'])",
          },
          max_price: {
            type: "number",
            description: "Maximum price in price_currency (default chaos).",
          },
          price_currency: { type: "string", description: "Currency for the maximum price filter (default chaos)." },
          online_only: { type: "boolean", description: "Legacy override: true selects available, false selects any. Omit for securable instant buyout." },
          limit: {
            type: "number",
            description: "Maximum results to return (1–10; default 5).",
          },
        },
        required: ["league", "jewel_size"],
      },
    },
    {
      name: "generate_shopping_list",
      truncatable: true,
      description: "List equipment from the saved active item set as a starting point for shopping. Does not calculate upgrades, prices, budget feasibility, or live unsaved changes. REQUIRES: POE_TRADE_ENABLED=true.",
      inputSchema: {
        type: "object",
        properties: {
          build_name: {
            type: "string",
            description: "Build to generate shopping list for",
          },
          league: {
            type: "string",
            description: "EXACT league name as specified by user",
          },
          budget_tier: {
            type: "string",
            description: "Legacy context only; does not filter items or calculate costs.",
            enum: ["budget", "medium", "endgame"],
          },
          budget: { type: "number", description: "Legacy budget number for context only; currency is unspecified and no filtering or costing is performed." },
        },
        required: ["build_name", "league"],
      },
    },
  ];
}

/**
 * Get build goals/diagnostics tool schemas (require Lua bridge, no Trade API dependency)
 */
export function getBuildGoalsToolSchemas(): ToolSchema[] {
  return [
    {
      name: "get_build_issues",
      truncatable: true,
      description: "Quick issue scan: uncapped resistances, low life, over-reserved mana, incomplete spell suppression. Lighter than validate_build. Use this for a fast check; use validate_build when you want full analysis including flask immunities and damage scaling. Do NOT call both.",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "get_passive_upgrades",
      truncatable: true,
      description: "Find reachable unallocated notable passives. Simulates each candidate together with PoB's current path and ranks relative stat gains per allocated point. Results depend on current configuration and do not guarantee affordability or build legality; verify before applying.",
      inputSchema: {
        type: "object",
        properties: {
          focus: {
            type: "string",
            description: "What to optimize for (default: 'both')",
            enum: ["dps", "defence", "both"],
          },
          max_results: {
            type: "number",
            description: "Maximum number of upgrade suggestions to return (default: 10)",
          },
          damage_metric: { type: "string", enum: ["CombinedDPS", "TotalDPS", "MinionCombinedDPS", "MinionTotalDPS"], description: "Required when player and minion damage are both positive. Unused for defence-only ranking." },
        },
      },
    },
    {
      name: "suggest_masteries",
      truncatable: true,
      description: "Evaluate the effects available on allocated mastery nodes against the live PoB build and rank the strongest DPS and defence choices. Requires a loaded build.",
      inputSchema: { type: "object", properties: { damage_metric: { type: "string", enum: ["CombinedDPS", "TotalDPS", "MinionCombinedDPS", "MinionTotalDPS"], description: "Required when player and minion damage are both positive." } } },
    },
    {
      name: "find_best_anointment",
      truncatable: true,
      description: "Rank anointable notables for an equipped Amulet or anointable Belt using upstream PoB's non-destructive live stat simulation. Requires a loaded build with the selected item equipped.",
      inputSchema: { type: "object", properties: { slot: { type: "string", enum: ["Amulet", "Belt"] }, focus: { type: "string", enum: ["dps", "defence", "both"] }, max_results: { type: "number" } }, required: ["slot"] },
    },
    {
      name: "analyze_build_cluster_jewels",
      truncatable: true,
      description: "Analyze the cluster jewels currently equipped in the build, evaluate which notables synergize with the build archetype, and flag wasted notables",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "analyze_cluster_jewels",
      description: "Analyze the cluster jewels in a saved build file: jewel size, passive count, and allocated notables. Reads the build XML directly — does not require the Lua bridge or Trade API.",
      inputSchema: {
        type: "object",
        properties: {
          build_name: {
            type: "string",
            description: "Build file to analyze (e.g., 'MyBuild.xml')",
          },
        },
        required: ["build_name"],
      },
    },
    {
      name: "suggest_watchers_eye",
      description: "Recommend valuable Watcher's Eye jewel mods based on the build's active auras, ranked by tier (S/A/B) with best combo suggestions",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "check_boss_readiness",
      description: "Compare available stats with rough heuristic boss thresholds. This is not proof of readiness; missing and inapplicable values are marked unknown, and boss difficulty must be explicit.",
      inputSchema: {
        type: "object",
        properties: {
          boss: {
            type: "string",
            description: "Supported: 'shaper', 'elder', 'sirus', 'maven', 'uber_elder', 'uber eater', 'uber exarch', or 'pinnacle' for generic endgame. Other Uber difficulties are unsupported.",
          },
        },
        required: ["boss"],
      },
    },
    {
      name: "suggest_crafting",
      description: "Collect crafting context and a verified base-page link. This is not a crafting rules engine or probability simulator; independently verify item state, game version and mechanics before suggesting steps. Currency reference is queried only when the exact international league is supplied.",
      inputSchema: {
        type: "object",
        properties: {
          slot: {
            type: "string",
            description: "Gear slot: helmet, chest, gloves, boots, weapon, offhand, ring, amulet, belt",
            enum: ["helmet", "chest", "gloves", "boots", "weapon", "offhand", "ring", "amulet", "belt"],
          },
          base: {
            type: "string",
            description: "Base item type (e.g. 'Hubris Circlet'). Auto-detected from equipped item if a build is loaded.",
          },
          desired_mods: {
            type: "array",
            items: { type: "string" },
            description: "List of desired mod descriptions (e.g. ['maximum life', 'cold resistance', 'spell damage'])",
          },
          budget: {
            type: "string",
            enum: ["low", "medium", "high"],
            description: "Subjective budget category; no fixed currency amount is implied.",
          },
          ilvl: {
            type: "number",
            description: "Caller-provided item level; applicability and available modifiers require independent verification.",
          },
          league: {
            type: "string",
            description: "Exact international league name for optional currency reference; no default is assumed.",
          },
        },
        required: ["slot"],
      },
    },
  ];
}

/**
 * Get poe.ninja API tool schemas
 */
export function getPoeNinjaToolSchemas(): ToolSchema[] {
  return [
    {
      name: "get_currency_rates",
      description: "Get current currency exchange rates from poe.ninja. Returns real-time market prices for all currencies in Chaos Orb equivalent. Updated every 5 minutes from live trading data. IMPORTANT: Use the EXACT league name the user specifies - do not substitute or guess.",
      inputSchema: {
        type: "object",
        properties: {
          league: {
            type: "string",
            description: "EXACT league name as specified by user (e.g., 'Standard', 'Settlers', 'Keepers', 'Hardcore'). Do not substitute or change this value.",
          },
        },
        required: ["league"],
      },
    },
    {
      name: "find_arbitrage",
      description: "Find currency arbitrage opportunities - profitable trading loops where you can trade currencies in a circle and end up with more than you started. Uses real-time poe.ninja rates to identify market inefficiencies. Perfect for making passive income through currency trading. IMPORTANT: Use the EXACT league name the user specifies - do not substitute or guess.",
      inputSchema: {
        type: "object",
        properties: {
          league: {
            type: "string",
            description: "EXACT league name as specified by user (e.g., 'Standard', 'Settlers', 'Keepers', 'Hardcore'). Do not substitute or change this value.",
          },
          min_profit_percent: {
            type: "number",
            description: "Minimum profit percentage to show (default: 1.0). Lower values find more opportunities but with smaller profits.",
          },
        },
        required: ["league"],
      },
    },
    {
      name: "calculate_trading_profit",
      description: "Calculate the profit/loss from a specific trading chain. Useful for testing your own trading strategies or validating arbitrage opportunities before executing them. Shows step-by-step conversion rates. IMPORTANT: Use the EXACT league name the user specifies - do not substitute or guess.",
      inputSchema: {
        type: "object",
        properties: {
          league: {
            type: "string",
            description: "EXACT league name as specified by user (e.g., 'Standard', 'Settlers', 'Keepers', 'Hardcore'). Do not substitute or change this value.",
          },
          currency_chain: {
            type: "array",
            description: "Array of currency names in trading order (e.g., ['Divine Orb', 'Chaos Orb', 'Exalted Orb', 'Divine Orb'])",
            items: {
              type: "string",
            },
          },
          start_amount: {
            type: "number",
            description: "Amount of first currency to start with (default: 1)",
          },
        },
        required: ["league", "currency_chain"],
      },
    },
    {
      name: "find_timeless_jewel_seeds",
      description: "Enumerate Elegant Hubris seeds with Path of Building's native lookup table for a socket in the loaded build. desired_node_ids are PoB legion node ids to score.",
      inputSchema: {
        type: "object",
        properties: {
          socket_node_id: { type: "number", description: "Passive-tree jewel socket node id" },
          desired_node_ids: { type: "array", description: "PoB legion node ids to match", items: { type: "string" } },
          limit: { type: "number", description: "Maximum ranked seeds to return (default 20, maximum 100)" },
          seeds: { type: "array", description: "Optional explicit seed numbers to inspect instead of enumerating the whole range", items: { type: "number" } },
          historic_figure: { type: "string", description: "Optional historic figure for a fixed Timeless Keystone; Caspiro grants Supreme Ostentation" },
          keystone_node_id: { type: "number", description: "Original Keystone node used by the build, required with historic_figure when scoring the fixed Keystone" },
          required_source_node_ids: { type: "array", description: "Optional original passive nodes on which at least one seed-dependent effect must occur", items: { type: "number" } },
        },
        required: ["socket_node_id", "desired_node_ids"],
      },
    },
  ];
}
