# When something fails

- **A router** that throws, takes too long or answers anything but a thread or nothing counts as having answered nothing: the next router is asked, or the event goes to `main`. The event gets `agentX-RouterError: <router file>: <why>`, which names the log of what the router printed, when it printed anything. Fix the router if the file is yours, tell a person if it is your developer's, then deal with the event.
- **A workflow** that fails is never run again by itself, since it may have done part of its work. An event on its babysitter thread says why and where its log is. Read the log and the script, fix the script if it is yours or tell a person if it is your developer's, check what was already done, then send the event to the workflow again.
- **An event you sent** that cannot be delivered, for example because its agent is not on your list or you have no such workflow, comes back to the thread that sent it and says why.
- **A schedule** with a broken entry is skipped, and an event on `main` says why.
