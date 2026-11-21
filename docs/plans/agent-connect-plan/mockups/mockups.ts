// The mockups for agent-connect-plan.md, drawn with scripts/plans/mockup-kit. Every visible string is copied from the
// plan's section 6 copy (or is the app's own string); `<…>` stand-ins mark what the plan does not define and carry the
// "assumed" marker. Names and owners ("Notes helper", "Ada") are sample data. The notes are annotations. Regenerate after
// any change here, to section 6's copy, or to the theme tokens:
//   node --experimental-strip-types docs/plans/agent-connect-plan/mockups/mockups.ts
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { CONTENT_W, HEADER_BOTTOM, TAB_TOP, type Mockup, writeMockups } from '../../../../scripts/plans/mockup-kit/kit.ts'

const PLAN = 'agent-connect-plan'
const TOP = HEADER_BOTTOM + 24
const BOTTOM = TAB_TOP - 64 // where the last control starts: above the tab bar
const ROOM_TITLE = '<title>'
const NO_ROOM_TITLE = 'the header title; the plan defines none for the room screens (§6).'
const NO_TAB_SHEET = 'covered by the sheet'

export const MOCKUPS: Mockup[] = [
  {
    file: '01-connect-name.svg',
    title: `Connect an agent: name step (${PLAN} §6)`,
    draw: (s) => {
      s.header('Connect an agent')
      let y = s.body('Name this agent', TOP)
      y = s.placeholder(y + 4, [CONTENT_W * 0.55]) + 18
      y = s.body('Memory it can use', y)
      y = s.placeholder(y + 4, [CONTENT_W * 0.4]) + 18
      y = s.layerRow('Connected for', y, { muted: '7 days, 30 days, 90 days' }) + 8
      s.label("You'll run a command in a terminal on the computer where Claude Code runs. It shows a code to scan.", y)
      s.primaryButton('Continue', BOTTOM)
      s.tabBar('myAgent')
    },
    notes: ['Grey bars stand for the name field and the memory choice ("None" and the owner’s contexts); the plan lists the options, not the control.', 'The expiry options are 7, 30 or 90 days, 30 by default; drawn as one line.'],
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
    file: '05-agent-list.svg',
    title: `AI agents: the list (${PLAN} §3.5, §3.13, §6)`,
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
    notes: ['Sample agent names. Status is one of Connected, Not connected right now, Expires in <n> days, Expired, Not finished, Revoke not confirmed, Revoked, plus "<name> changed its key" where it applies (not drawn); each row also states its "Answers other people" value.', 'Each row has "Extend" and "Revoke" actions, not drawn.', 'The plan says the way in is a row on the My Agent card; a primary button here is a mockup choice.'],
  },
  {
    file: '06-agent-sheet.svg',
    title: `Agent bottom sheet: owner and "Answers other people" (${PLAN} §3.6, §3.13, §6)`,
    draw: (s) => {
      s.header('AI agents')
      s.tabBar('myAgent')
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
    notes: ['The bottom sheet is RoomIdentitySheet, extended; it opens from a member-list row, a record’s author or the agent list.', 'The setting is a switch, not drawn; its value is "Off" here. Owner "Ada" and the agent name are samples.', 'The fixed text is shown in the app’s language; the plugin sends it in the language Keyring tells it (§3.13).'],
  },
  {
    file: '07-answers-others-confirm.svg',
    title: `Turning "Answers other people" on (${PLAN} §3.13, §6)`,
    draw: (s) => {
      s.header('AI agents')
      s.tabBar('myAgent')
      s.bottomSheet((sheet, y) => {
        let yy = sheet.heading('Let "Notes helper" answer other people?', y) + 10
        yy = sheet.body('Anyone in a room can then ask it to do things by mentioning it. It could be tricked into using your memory or posting for you, and your phone cannot prevent that.', yy) + 14
        yy = sheet.primaryButton('Turn on', yy) + 12
        return sheet.secondaryButton('Keep it off', yy)
      })
    },
    notes: ['Shown over the agent sheet each time the setting is turned on. Turning it off needs no confirmation.', '"Turn on" as the primary button is a mockup choice; the plan names the two buttons only.'],
  },
  {
    file: '08-room-members-agents.svg',
    title: `Room member list: the Agents section (${PLAN} §3.6, §6)`,
    draw: (s) => {
      s.header(undefined, { placeholder: ROOM_TITLE, assumed: NO_ROOM_TITLE })
      s.tabBar('myAgent')
      let y = s.heading('Agents', TOP)
      y = s.layerRow('Notes helper', y + 4, { muted: 'AI agent. Belongs to Ada. @notes-helper-7f3k' })
      y = s.label("Agents Keyring connected for you. Other people's agents are not listed here.", y + 4) + 20
      s.placeholder(y, [CONTENT_W * 0.5, CONTENT_W * 0.7, CONTENT_W * 0.6])
    },
    omits: { primary: 'the member list has no main action; tapping a row opens the agent sheet.' },
    notes: ['The Members tab (RoomMembersTab) with a new section above the community’s list. The grey bars stand for that list, or for its "unavailable" notice: the Agents section shows either way, since it comes from Keyring’s own records.', 'Tapping the row opens the agent bottom sheet (06). The mark is the existing "AI agent" string.', 'Sample agent and owner names.'],
  },
  {
    file: '09-room-add-agent.svg',
    title: `Add an agent to a room (${PLAN} §3.6, §6)`,
    draw: (s) => {
      s.header(undefined, { placeholder: ROOM_TITLE, assumed: NO_ROOM_TITLE })
      s.tabBar('myAgent')
      s.bottomSheet((sheet, y) => {
        let yy = sheet.heading('Add "Notes helper" to this room?', y) + 10
        yy = sheet.body('Adding an agent gives it read access to this room. It is asked to act only when you mention it, but nothing in the room enforces that.', yy) + 10
        yy = sheet.body('It can also read and change your memory "Personal", as can any other agent you add to a room.', yy) + 14
        yy = sheet.primaryButton('Add to room', yy) + 12
        return sheet.secondaryButton('Not now', yy)
      })
    },
    notes: ['The read-access and memory notices are read before "Add to room" is focusable; "Add to room" confirms both. The memory line shows whenever the add puts the persona\u2019s context in the agent\u2019s reach; "Personal" is a sample context.', 'For a community room that says no, or says nothing, the action is off and the sheet is not reached (§3.8).'],
  },
  {
    file: '10-revoke.svg',
    title: `Revoke an agent (${PLAN} §3.9, §6)`,
    draw: (s) => {
      s.header(undefined, { placeholder: '<title>', assumed: 'the header title of the agent details screen; the plan defines none (§6).' })
      s.tabBar('myAgent')
      s.bottomSheet((sheet, y) => {
        let yy = sheet.heading('Revoke "Notes helper"?', y) + 10
        yy = sheet.body('It loses access to your memory and rooms. A room permission it already holds can work for up to 4 hours. Past messages stay.', yy) + 14
        yy = sheet.primaryButton('Revoke', yy) + 12
        return sheet.secondaryButton('Keep', yy)
      })
    },
    notes: ['Never says "instant". If the VTA cannot be reached the agent stays connected and Keyring says "We couldn’t reach your VTA, so "<name>" is still connected."'],
  },
  {
    file: '11-pairing-expired.svg',
    title: `Connect an agent: code expired (${PLAN} §3.2, §6)`,
    draw: (s) => {
      s.header('Connect an agent')
      s.errorNotice('This code has expired. Run the command again.', TOP)
      s.primaryButton('Close', BOTTOM)
      s.tabBar('myAgent')
    },
    notes: ['An unclaimed code expires after 5 minutes; after the scan the person has 120 seconds to type the number and approve. Nothing was granted.'],
  },
]

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const f of writeMockups(path.dirname(fileURLToPath(import.meta.url)), MOCKUPS)) console.log(f)
}
