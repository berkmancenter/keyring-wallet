/**
 * The agent chat's route (plan §7.9; backlog 2 R3): `AgentChatView` over fb-C4's `useAgentChat(agentId)`, registered
 * in MessageStack and MyAgentStack with the developer switch on. The view draws its own header, so the navigator's is
 * hidden (`headerShown: false`) and Back is the view's.
 *
 * A container only: it reads the hook and passes props.
 * - A message the agent sent with no text (a photo or a file, not carried in P0) shows `Chat.UnsupportedAttachment`,
 *   as a person's chat does.
 * - "Belongs to {owner}": the hook gives no owner's name, and no record holds one yet (the agent's record keeps the
 *   persona's DID; only `AgentView.ownerName` names it, and nothing sets that outside the fixtures). So none is passed,
 *   and the view leaves the line out rather than draw "Belongs to" with no name.
 * - **Decided here:** with no `AgentChatProvider` mounted (`useAgentChatService()` undefined) there is no chat to show
 *   and no true words for that, so the screen goes back and draws nothing. Nothing mounts the provider yet: fb-C4 says
 *   it goes in `ConnectedAgentsRoot` or above it, at the app's root (it must be above Messages too, for
 *   `useAgentMessageRows`).
 */
import React, { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { useAgentChat, useAgentChatService } from '../../modules/connected-agents/chat/useAgentChat'
import AgentChatView, { type AgentChatViewMessage } from '../../modules/connected-agents/screens/AgentChatView'
import { formatTime } from '../../utils/helpers'

/** The route's params, the same in MessageStack and MyAgentStack. */
export interface AgentChatScreenProps {
  navigation: { goBack: () => void }
  route: { params: { agentId: string; name: string } }
}

/** A message's time, in the app's own time format. */
export const formatChatTime = (iso: string): string => formatTime(new Date(iso), { includeHour: true, trim: true })

const Chat: React.FC<AgentChatScreenProps> = ({ navigation, route }) => {
  const { agentId, name } = route.params
  const { t } = useTranslation()
  const chat = useAgentChat(agentId)

  const messages = useMemo<AgentChatViewMessage[]>(
    () =>
      (chat.messages ?? []).flatMap((m) => {
        const text = m.text ?? (m.unsupportedAttachment ? t('Chat.UnsupportedAttachment') : undefined)
        return text === undefined ? [] : [{ id: m.eventId, mine: m.role === 'sent', text, at: m.at }]
      }),
    [chat.messages, t]
  )

  return (
    <AgentChatView
      name={name}
      messages={messages}
      state={chat.state}
      stopped={chat.stopped}
      onSend={(text) => void chat.send(text).catch(() => undefined)}
      formatTime={formatChatTime}
      onBack={navigation.goBack}
    />
  )
}

/** With no chat service mounted, back to where it was opened from. */
const NoChat: React.FC<{ goBack: () => void }> = ({ goBack }) => {
  useEffect(() => goBack(), [goBack])
  return null
}

const AgentChatScreen: React.FC<AgentChatScreenProps> = (props) =>
  useAgentChatService() ? <Chat {...props} /> : <NoChat goBack={props.navigation.goBack} />

export default AgentChatScreen
