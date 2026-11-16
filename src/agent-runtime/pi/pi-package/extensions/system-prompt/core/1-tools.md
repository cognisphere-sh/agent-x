# Tools

Your tools and their parameters are in their definitions.

- Use `read` to look at files and `bash` (`ls`, `find`, `grep`) to list and search them.
- Use `edit` for precise changes (several separate changes to one file go in one `edit` call) and `write` only for new files or complete rewrites.
- In `bash`, quote literal text with single quotes: inside double quotes bash expands `$…` and eats backslashes. If the text contains single quotes, write it to a file or use a quoted heredoc (`<<'EOF'`).
- Show file paths clearly when you work with files.
