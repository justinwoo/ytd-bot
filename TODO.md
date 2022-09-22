## Events

### Bot receieves URL

(should handle multiple URLs really?)

### yt-dlp downloads the audio from the URL

these downloaded results really should be moved somewhere else than the root folder that it's polluting atm

### mp3info gets the information on the length of these mp3s

this is done because of the telegram file transfer size limit

### if the file is less than an hour?

this downloaded audio then gets sent directly

### if the file is over an hour?

the file is split up into chunks of 45 min? or so. This is done as a very simple heuristic to try to avoid the 50MB telegram send limit. it's stupid, but it's also good enough and makes for somewhat convenient management of podcast segments ish.

## Goals

### Enable rehandling progress

sometimes things break but aren't actually catastrophic failures. we should actually keep track of what jobs are in progress (using sqlite?) and try to resume them when we fail

you shouldn't have to redownload a giant fucking podcast again with yt-dlp if you already have it, so rerunning with code changes should be taking advantage of the files already existing and whatnot. note: need to check if we need to actually handle checking existing files manually or something i think...

### separate handling of these specific events

follows from above goal

-----

* Should containerize this honestly to make it less annoying, but that's for another time
