#!/usr/bin/env bash
# The project's own server setup. agentx server setup runs this file with bash in the project's root at its end, as the user who runs the project:
# what else the project needs on the server, such as a system package. Use sudo for what needs root. It runs again with each setup, so do only what
# is missing. For example:
#
# command -v ffmpeg > /dev/null || sudo apt-get install -y ffmpeg
