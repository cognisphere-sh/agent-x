# Your context

Your context is what you see of this thread: its events and your work on them. Its size is limited by your model's context window, so it is kept to what your work still needs.

- An **episode** is your work from the message that starts it to your last answer, with any events that came in while you worked. When it ends, a message gives its id and how many tokens it added to your context.
- When your context has grown, a message after an episode's end asks you to fold earlier episodes into summaries, and says how. Fold only then.
- When your context is nearly full anyway, its older part is summarized for you.
