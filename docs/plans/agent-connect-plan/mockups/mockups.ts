// The mockups for agent-connect-plan.md, drawn with scripts/plans/mockup-kit. Every visible string is copied from the
// plan's section 6 copy (or is the app's own string); `<…>` stand-ins mark what the plan does not define and carry the
// "assumed" marker. Names, owners, rooms, memories and dates ("Notes helper", "Ada", "Campus notes", "Education",
// "23 December 2026") are sample data. The notes are annotations. Regenerate after any change here, to section 6's
// copy, or to the theme tokens:
//   node --experimental-strip-types docs/plans/agent-connect-plan/mockups/mockups.ts
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { CONTENT_W, HEADER_BOTTOM, TAB_TOP, type Mockup, writeMockups } from '../../../../scripts/plans/mockup-kit/kit.ts'
import { tok } from '../../../../scripts/plans/mockup-kit/tokens.ts'

const PLAN = 'agent-connect-plan'
const TOP = HEADER_BOTTOM + 24
const BOTTOM = TAB_TOP - 64 // where the last control starts: above the tab bar
const ROOM_TITLE = '<title>'
const NO_ROOM_TITLE = 'the header title; the plan defines none for the room screens (§6).'
const APP_TITLE = 'the screen’s own title is the app’s string, not plan copy, and the kit has no token for it yet.'
const ROOMS_FROM_MESSAGES = 'Rooms open from Messages in its own stack (D26), so the Message tab is active.'
const AGENT_EDGE = tok('color.primary') as string

export const MOCKUPS: Mockup[] = [
  {
    file: '01-connect-name.svg',
    title: `Connect an agent: name step (${PLAN} §3.15, §6)`,
    draw: (s) => {
      s.header('Connect an agent')
      let y = s.body('Name this agent', TOP)
      y = s.placeholder(y + 4, [CONTENT_W * 0.55]) + 14
      y = s.body('Memory it can use', y)
      y = s.layerRow('Education', y + 2)
      y = s.layerRow('Healthcare', y)
      y = s.layerRow('New memory', y)
      y = s.label('Your VTA keeps this agent to these memories. To use different ones in a room, connect another agent for it.', y + 2) + 6
      y = s.layerRow('Connected for', y, { muted: '7 days, 30 days, 90 days' }) + 6
      s.label("You'll run a command in a terminal on the computer where Claude Code runs. It shows a code to scan.", y)
      s.primaryButton('Continue', BOTTOM)
      s.tabBar('myAgent')
    },
    notes: ['The grey bar stands for the name field.', '"Memory it can use" is the memory picker (§3.15): checkbox rows (boxes not drawn), any number or none, and "New memory". Sample memories.', 'The line under the rows is the binding (§3.15): the VTA keeps the agent to the picked set; a different set in a room is another agent.', 'Expiry: 7, 30 or 90 days, 30 by default; drawn as one line.'],
  },
  {
    file: '02-connect-scan.svg',
    title: `Connect an agent: scan step (${PLAN} §6)`,
    draw: (s) => {
      s.header('Connect an agent')
      s.heading('Scan the code in your terminal', TOP + 40)
      s.tertiaryButton('Paste the link instead', BOTTOM)
      s.tabBar('myAgent')
    },
    omits: { primary: 'the action is scanning the terminal’s code; the plan defines no button for this step (§6).' },
    notes: ['The camera view is not drawn. "Paste the link instead" is the non-camera path; a tertiary button is a mockup choice.', 'The code is valid for 5 minutes and one claim (§3.2).'],
  },
  {
    file: '03-connect-number.svg',
    title: `Connect an agent: enter the number (${PLAN} §3.2, §6)`,
    draw: (s) => {
      s.header('Connect an agent')
      let y = s.heading('Enter the number from your terminal', TOP) + 8
      y = s.body('Type the four digits your terminal shows. You get one try.', y) + 24
      s.display('_ _ _ _', y)
      const b = s.primaryButton('Continue', BOTTOM - 56)
      s.secondaryButton('Cancel', b + 12)
      s.tabBar('myAgent')
    },
    notes: ['The number field, empty. Keyring never shows the number: only the terminal does, so there is nothing to compare.', 'Four digit cells, numeric keypad, labelled "Number from your terminal"; each digit is announced as it is typed.', 'One attempt per pairing. 120 seconds from the scan to the approval (§3.2).'],
  },
  {
    file: '04-connect-wrong-number.svg',
    title: `Connect an agent: wrong number (${PLAN} §3.2, §6)`,
    draw: (s) => {
      s.header('Connect an agent')
      const y = s.errorNotice("That isn't the number in your terminal. Nothing was connected.", TOP)
      s.display('4 1 7 2', y + 32)
      s.primaryButton('Close', BOTTOM)
      s.tabBar('myAgent')
    },
    notes: ['The four digits the person typed (a sample) stay in their cells under the notice; there is no second try. The pairing is over: the code is spent and nothing was granted. A new code means running the command again.', 'Three wrong numbers within 60 minutes lock "Connect an agent" for 15 minutes ("Too many wrong numbers. Try again in <n> minutes."), drawn as this layout with its line.', 'An InfoBox error with the string as its title: a mockup choice.'],
  },
  {
    file: '05-approve.svg',
    title: `Connect an agent: approve (${PLAN} §3.2, §6)`,
    draw: (s) => {
      s.header('Connect an agent')
      let y = s.heading('Connect "Notes helper"?', TOP) + 10
      y = s.body('It will be able to chat with you.', y)
      y = s.body('It will be able to use the memories Education, Healthcare, and no others.', y)
      y = s.body('Until 23 December 2026.', y)
      y = s.body('It can read a room only after you add it to one.', y) + 10
      s.body('Only continue if you ran the command in your own terminal just now.', y)
      s.primaryButton('Approve', BOTTOM)
      s.tabBar('myAgent')
    },
    notes: ['Shown after the right number was typed. "Approve" asks for the phone’s face or fingerprint check (§3.2 step 6).', 'With no memory picked the second line reads "It will have no memory." The date and the memories are samples.'],
  },
  {
    file: '06-agent-list.svg',
    title: `AI agents: the list, the My Agent tab’s first screen (${PLAN} §3.5, §3.13, §6, D26)`,
    draw: (s) => {
      s.header('AI agents')
      let y = s.layerRow('Notes helper', TOP, { muted: 'Connected' })
      y = s.label('Answers other people: Off', y - 6) + 10
      y = s.layerRow('Travel agent', y, { muted: 'Expired' })
      y = s.label('Answers other people: Off', y - 6) + 10
      y = s.layerRow('Inbox triage', y, { muted: 'Not connected right now' })
      s.label('Answers other people: On', y - 6)
      s.primaryButton('Connect an agent', BOTTOM)
      s.tabBar('myAgent')
    },
    notes: ['The My Agent tab opens here (D26); the VTA’s screens are under Settings as "My VTA" (19).', 'Sample names. Status is one of Connected, Not connected right now, Expires in <n> days, Expired, Not finished, Revoke not confirmed, Revoked, plus "<name> changed its key" (not drawn).', 'A row opens the agent details (11); "Extend" and "Revoke" not drawn. The primary button is a mockup choice.'],
  },
  {
    file: '07-agent-sheet.svg',
    title: `Agent bottom sheet: owner and "Answers other people" (${PLAN} §3.6, §3.13, §6)`,
    draw: (s) => {
      s.header(undefined, { placeholder: ROOM_TITLE, assumed: NO_ROOM_TITLE })
      s.tabBar('messages')
      s.bottomSheet((sheet, y) => {
        let yy = sheet.heading('Notes helper', y)
        yy = sheet.body('AI agent', yy + 4)
        yy = sheet.body('Belongs to Ada', yy)
        yy = sheet.body('Mention it as @notes-helper-7f3k.', yy) + 8
        yy = sheet.layerRow('Answers other people', yy, { muted: 'Off' })
        yy = sheet.label("Anyone but you who mentions Notes helper gets a fixed reply that it can't respond to others.", yy + 4) + 8
        yy = sheet.label("What others see: I'm an AI agent and I can't respond to anyone but the person I work for.", yy)
        return yy
      })
    },
    omits: { primary: 'the sheet’s actions are rows and a switch (§6); the plan defines no button for it.' },
    notes: ['RoomIdentitySheet, extended; from a member-list row or a record’s author. The agent list opens the details (11).', 'Switch not drawn; "Off" here. Sample names.'],
  },
  {
    file: '08-answers-others-confirm.svg',
    title: `Turning "Answers other people" on (${PLAN} §3.13, §6)`,
    draw: (s) => {
      s.header(undefined, { placeholder: ROOM_TITLE, assumed: NO_ROOM_TITLE })
      s.tabBar('messages')
      s.bottomSheet((sheet, y) => {
        let yy = sheet.heading('Let "Notes helper" answer other people?', y) + 10
        yy = sheet.body('Anyone in a room can then ask it to do things by mentioning it. It could be tricked into using your memory or posting for you, and your phone cannot prevent that.', yy) + 14
        yy = sheet.primaryButton('Turn on', yy) + 12
        return sheet.secondaryButton('Keep it off', yy)
      })
    },
    notes: ['Over the agent sheet (07) or the details (11), each time the setting is turned on; off needs no confirmation.', '"Turn on" as the primary button is a mockup choice.'],
  },
  {
    file: '09-contacts-agent-row.svg',
    title: `Contacts: the agent as a contact (${PLAN} §3.14, §6)`,
    draw: (s) => {
      s.header(undefined, { placeholder: '<title>', assumed: APP_TITLE })
      let y = s.cardRow('Ines Costa', TOP, { trailing: 'chevron' }) + 10
      y = s.cardRow('Jordan Sample', y, { trailing: 'chevron' }) + 10
      y = s.cardRow('Notes helper', y, { badge: 'AI', trailing: 'chevron', outline: AGENT_EDGE })
      y = s.label('AI agent · Your AI agent', y + 4) + 10
      s.cardRow('Noor Haddad', y, { trailing: 'chevron' })
      s.tabBar('contacts')
    },
    omits: { primary: 'the Contacts list has no main action; tapping a row opens the contact’s details, for an agent its details screen (11).' },
    notes: ['The agent row comes from Keyring’s own agent records, sorted among the people. Its own card: the mark "AI agent", "Your AI agent" in place of badges, no photo, a dashed edge (drawn solid here) (§3.14).', 'Sample names; "AI" marks the card.'],
  },
  {
    file: '10-messages-agent-row.svg',
    title: `Messages: the agent chat in the list (${PLAN} §3.14, §6)`,
    draw: (s) => {
      s.header(undefined, { placeholder: '<title>', assumed: APP_TITLE })
      let y = s.cardRow('Campus notes', TOP, { badge: '#', trailing: 'chevron' }) + 10
      y = s.cardRow('Notes helper', y, { badge: 'AI', trailing: 'chevron', outline: AGENT_EDGE })
      y = s.label('AI agent', y + 4) + 10
      y = s.cardRow('Noor Haddad', y, { trailing: 'chevron' }) + 10
      s.placeholder(y + 6, [CONTENT_W * 0.6, CONTENT_W * 0.45])
      s.tabBar('messages')
    },
    omits: { primary: 'the Messages list has no main action; tapping a row opens its chat.' },
    notes: ['A third kind of row beside people and rooms, ordered by its last message, with its contact card’s mark and edge (§3.14). Its chat header reads "Notes helper · AI agent · Belongs to Ada" (not drawn).', '"#" stands for a room; grey bars for more rows. Sample names.'],
  },
  {
    file: '11-agent-details.svg',
    title: `Agent details: the agent’s contact page (${PLAN} §3.14, §3.15, §6)`,
    draw: (s) => {
      s.header(undefined, { placeholder: '<title>', assumed: 'the header title of the agent details screen; the plan defines none (§6).' })
      let y = s.heading('Notes helper', TOP)
      y = s.body('AI agent', y + 2)
      y = s.body('Belongs to Ada', y)
      y = s.body('Mention it as @notes-helper-7f3k.', y) + 8
      y = s.primaryButton('Message', y) + 12
      y = s.layerRow('Answers other people', y, { muted: 'Off' }) + 4
      y = s.body('Memories: Education, Healthcare.', y)
      y = s.label('Can use memory Education, Healthcare in every room it is in.', y + 2)
      y = s.label('Your VTA keeps it to these memories.', y)
      y = s.layerRow('Change memories', y + 4) + 6
      const e = s.tertiaryButton('Extend', y)
      s.tertiaryButton('Revoke', e)
      s.tabBar('myAgent')
    },
    notes: ['Reached from the contact row (09) and the agent list (06). "Message" opens the agent chat (§3.14).', 'The memory lines are §3.15’s: one line for every room, since the VTA binds the set to the agent, not to a room. "Change memories" opens 20. Samples.', 'Tertiary "Extend" and "Revoke" are a mockup choice; Revoke opens 17.'],
  },
  {
    file: '12-composer-add-sheet.svg',
    title: `Room composer: the "+" sheet (${PLAN} §3.15, §6, D28)`,
    draw: (s) => {
      s.header(undefined, { placeholder: ROOM_TITLE, assumed: NO_ROOM_TITLE })
      s.tabBar('messages')
      s.placeholder(TOP, [CONTENT_W * 0.7, CONTENT_W * 0.5, CONTENT_W * 0.65])
      s.bottomSheet((sheet, y) => {
        let yy = sheet.layerRow('Add a file', y)
        yy = sheet.layerRow('Add my agent', yy)
        return yy
      })
    },
    omits: { primary: 'the sheet’s rows are the actions; the plan defines no button for it (§6).' },
    notes: ['Opened by the "+" next to the message field once the person has an agent; with none the "+" picks a file at once, as today (§3.15).', '"Add my agent" runs the add (13, ending at the read-only sheet 14); where the community says no, or nothing, the row is disabled with that line (§3.8).', ROOMS_FROM_MESSAGES],
  },
  {
    file: '13-room-add-agent.svg',
    title: `Add an agent to a room (${PLAN} §3.6, §6)`,
    draw: (s) => {
      s.header(undefined, { placeholder: ROOM_TITLE, assumed: NO_ROOM_TITLE })
      s.tabBar('messages')
      s.bottomSheet((sheet, y) => {
        let yy = sheet.heading('Add "Notes helper" to this room?', y) + 10
        yy = sheet.body('Adding an agent gives it read access to this room. It is asked to act only when you mention it, but nothing in the room enforces that.', yy) + 10
        yy = sheet.body('It can also read and change your memory "Personal", as can any other agent you add to a room.', yy) + 10
        yy = sheet.body('Members of this room will see that this agent belongs to you.', yy) + 14
        yy = sheet.primaryButton('Add to room', yy) + 12
        return sheet.secondaryButton('Not now', yy)
      })
    },
    notes: ['From "Agents in this room" (15) or the "+" sheet (12). Both notices are read before "Add to room" is focusable; it confirms both, then the read-only sheet 14 follows (there is no memory to pick). "Personal" is a sample context.', 'A community room that says no, or nothing, never reaches this sheet (§3.8).', ROOMS_FROM_MESSAGES],
  },
  {
    file: '14-what-it-remembers.svg',
    title: `What the agent remembers: read-only (${PLAN} §3.15, §6)`,
    draw: (s) => {
      s.header(undefined, { placeholder: ROOM_TITLE, assumed: NO_ROOM_TITLE })
      s.tabBar('messages')
      s.bottomSheet((sheet, y) => {
        let yy = sheet.heading('What Notes helper remembers', y) + 8
        yy = sheet.body('Notes helper can use only these memories, in every room it is in: Education, Healthcare. Your VTA keeps it to them.', yy) + 8
        yy = sheet.body('Memory is stored as text on your VTA. It is not a place for secrets.', yy) + 10
        yy = sheet.primaryButton('Done', yy) + 12
        return sheet.secondaryButton('Connect another agent', yy)
      })
    },
    notes: ['Follows 13; opens again from the agent’s row in 15 or its details (11). Read-only: the owner picks nothing here, because the VTA binds the memories to the agent and not to a room (§3.15, D31).', '"Connect another agent" starts the connect flow (01) for a different set; "Change memories" is on the details (11, 20). With no memory the body reads "Notes helper has no memory."', ROOMS_FROM_MESSAGES],
  },
  {
    file: '15-room-agents-section.svg',
    title: `Room info: "Agents in this room" (${PLAN} §3.6, §3.15, §6)`,
    draw: (s) => {
      s.header(undefined, { placeholder: ROOM_TITLE, assumed: NO_ROOM_TITLE })
      s.tabBar('messages')
      let y = s.heading('Agents in this room', TOP)
      y = s.layerRow('Notes helper', y + 4, { muted: 'AI agent. Memory: Education' })
      y = s.layerRow('Study buddy', y, { muted: 'AI agent. No memory' })
      y = s.layerRow('Add an agent', y)
      y = s.label('Agents added here can read everything in this room, not only messages that mention them.', y + 4) + 20
      s.placeholder(y, [CONTENT_W * 0.5, CONTENT_W * 0.7])
    },
    omits: { primary: 'the section’s rows are the actions: an agent’s row opens "What it remembers here" (14, read-only) and "Add an agent" starts the add (13).' },
    notes: ['A section of the room’s info screen. "Memory: Education" is the agent’s bound set, the same in every room; an agent with none reads "No memory". Grey bars: the rest of the screen.', ROOMS_FROM_MESSAGES],
  },
  {
    file: '16-room-members-agents.svg',
    title: `Room member list: the Agents section (${PLAN} §3.6, §6)`,
    draw: (s) => {
      s.header(undefined, { placeholder: ROOM_TITLE, assumed: NO_ROOM_TITLE })
      s.tabBar('messages')
      let y = s.heading('Agents', TOP)
      y = s.layerRow('Notes helper', y + 4, { muted: 'AI agent. Belongs to Ada. @notes-helper-7f3k' })
      y = s.label("Agents Keyring connected for you. Other people's agents are not listed here.", y + 4) + 20
      s.placeholder(y, [CONTENT_W * 0.5, CONTENT_W * 0.7, CONTENT_W * 0.6])
    },
    omits: { primary: 'the member list has no main action; tapping a row opens the agent sheet.' },
    notes: ['The Members tab with a new section above the community’s list (the grey bars, or its "unavailable" notice); the section shows either way, from Keyring’s own records.', 'Tapping the row opens the agent sheet (07). Sample names.', ROOMS_FROM_MESSAGES],
  },
  {
    file: '17-revoke.svg',
    title: `Revoke an agent (${PLAN} §3.9, §6)`,
    draw: (s) => {
      s.header(undefined, { placeholder: '<title>', assumed: 'the header title of the agent details screen; the plan defines none (§6).' })
      s.tabBar('myAgent')
      s.bottomSheet((sheet, y) => {
        let yy = sheet.heading('Revoke "Notes helper"?', y) + 10
        yy = sheet.body('It loses access to your memory and rooms. A room permission it already holds can work for up to 4 hours. Past messages stay.', yy) + 8
        yy = sheet.layerRow('Also delete what it remembered', yy) + 8
        yy = sheet.primaryButton('Revoke', yy) + 12
        return sheet.secondaryButton('Keep', yy)
      })
    },
    notes: ['Opened from the agent details (11). Never says "instant". If the VTA cannot be reached the agent stays connected and Keyring says "We couldn’t reach your VTA, so "<name>" is still connected."', '"Also delete what it remembered" is the P2 row (§3.15, step 7.18): it erases the items, the memory stays; never "no trace". P0 and P1 have no such row.', 'Revoke is also how the agent leaves Contacts and Messages (§3.14).'],
  },
  {
    file: '18-pairing-expired.svg',
    title: `Connect an agent: code expired (${PLAN} §3.2, §6)`,
    draw: (s) => {
      s.header('Connect an agent')
      s.errorNotice('This code has expired. Run the command again.', TOP)
      s.primaryButton('Close', BOTTOM)
      s.tabBar('myAgent')
    },
    notes: ['An unclaimed code expires after 5 minutes; after the scan the person has 120 seconds to type the number and approve. Nothing was granted.'],
  },
  {
    file: '19-settings-my-vta.svg',
    title: `Settings: the "My VTA" row (${PLAN} §6, D26)`,
    draw: (s) => {
      s.header(undefined, { placeholder: '<title>', assumed: APP_TITLE })
      let y = s.placeholder(TOP, [CONTENT_W * 0.45, CONTENT_W * 0.55, CONTENT_W * 0.4]) + 16
      y = s.layerRow('My VTA', y, { outline: AGENT_EDGE }) + 16
      s.placeholder(y, [CONTENT_W * 0.5, CONTENT_W * 0.35])
      s.tabBar('menu')
    },
    omits: { primary: 'Settings is a list of rows; the plan defines no button for it.' },
    notes: ['The app titles this screen "Menu" (its own string); the row sits in its "App Settings" group. "My VTA" opens the whole stack that was the My Agent tab, unchanged, with "My VTA" as its header (D26, step 5a). The outline only points at the row.'],
  },
  {
    file: '20-change-memories.svg',
    title: `Change memories: widening asks first (${PLAN} §3.15, §6, D34)`,
    draw: (s) => {
      s.header(undefined, { placeholder: '<title>', assumed: 'the header title of the agent details screen; the plan defines none (§6).' })
      s.tabBar('myAgent')
      s.bottomSheet((sheet, y) => {
        let yy = sheet.heading('Let "Notes helper" use "Work"?', y) + 10
        yy = sheet.body('This also applies in Campus notes, Clinic team. It will be able to read and change it.', yy) + 14
        yy = sheet.primaryButton('Allow', yy) + 12
        return sheet.secondaryButton('Not now', yy)
      })
    },
    notes: ['From "Change memories" on the details (11), after the owner ticks a memory the agent lacks. It names every room, because widening applies at once in all of them (§3.15). "Allow" asks for face or fingerprint.', 'Narrowing is this sheet with its own copy ("Stop "Notes helper" using "Healthcare"?", "Stop using", "Keep"): one confirmation, no biometric.', 'Widening after connect is decided (D34): the approval names every room.'],
  },
  {
    file: '21-delete-memory.svg',
    title: `Delete a memory: explicit confirm, P1 (${PLAN} §3.15, §6)`,
    draw: (s) => {
      s.header(undefined, { placeholder: '<title>', assumed: 'the header title of a memory screen; the plan defines none and no memory-management screen is in P0 (§3.15).' })
      s.tabBar('myAgent')
      s.bottomSheet((sheet, y) => {
        let yy = sheet.heading('Delete "Education"?', y) + 10
        yy = sheet.body('This destroys the 214 items it remembers and removes the memory from Notes helper. This can\u2019t be undone.', yy) + 14
        yy = sheet.primaryButton('Delete', yy) + 12
        return sheet.secondaryButton('Keep', yy)
      })
    },
    notes: ['P1, with the memory-management screen. The count (214 is a sample) is Keyring’s own: the VTA’s delete warning does not count memory items, so a memory holding only items would delete without asking (§3.15).', 'The agents bound to it are named. Keyring sends the delete with `force` only after this sheet. The copy says "destroys", never "no trace".'],
  },
  {
    file: '22-memory-drift.svg',
    title: `Agent details: its memory access changed (${PLAN} §3.15, §6)`,
    draw: (s) => {
      s.header(undefined, { placeholder: '<title>', assumed: 'the header title of the agent details screen; the plan defines none (§6).' })
      let y = s.heading('Notes helper', TOP)
      y = s.body('AI agent', y + 2) + 8
      y = s.errorNotice('Its memory access changed.', y, 'Something other than you changed what it can use.') + 8
      y = s.primaryButton('Restore', y) + 12
      y = s.tertiaryButton('Revoke', y) + 8
      y = s.label('Lost access to Healthcare.', y + 4)
      s.tabBar('myAgent')
    },
    notes: ['Shown at app start and on opening the list or details when the entry holds a context beyond the agent’s memories and its rooms’ (§3.15 step 5). "Restore" narrows the entry back after one confirmation; "Revoke" opens 17.', '"Lost access to <memory>" is the opposite case, a memory the agent should have and no longer does; drawn here as its line. The body line under the title is a mockup choice (the plan defines the title only).'],
  },
  {
    file: '23-not-an-administrator.svg',
    title: `Connect an agent: the guard for a phone that is not an unrestricted administrator (${PLAN} §1.5, §3.15, D32)`,
    draw: (s) => {
      s.header('Connect an agent')
      s.errorNotice("This phone can't connect an agent. Connecting needs full administrator access to your VTA.", TOP)
      s.primaryButton('Close', BOTTOM)
      s.tabBar('myAgent')
    },
    notes: ['Shown when `auth/whoami` at connect time says the session is not an unrestricted administrator. Keyring assumes it always is (§1.5); this is that assumption being enforced, not a degraded mode: nothing is created and no other role is tried.', 'Step 0.1(p) confirms the assumption live; a scoped phone reopens D32.'],
  },
]

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const f of writeMockups(path.dirname(fileURLToPath(import.meta.url)), MOCKUPS)) console.log(f)
}
