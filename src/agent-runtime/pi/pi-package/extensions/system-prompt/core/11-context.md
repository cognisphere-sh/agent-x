# Your context

Your context is what you see of this thread: its events and your work on them. Its size is limited by your model's window (see `agentx-model`), so it is kept to what your work still needs.

- An **episode** is your work from the message that starts it to your last answer, with any events that came in while you worked. Each has an id of its own: its first message starts with `Episode <id> started.`, and when it ends, a message gives its id and how many tokens of your context it used.
- When your context has grown, a message after an episode's end asks you to fold earlier episodes into summaries, and says how. Fold only then.
- `episode_read` with an episode id gives back that episode, also when it was folded or summarized.
- When your context is nearly full, older episodes are summarized for you, and the most recent episodes stay as they are.
