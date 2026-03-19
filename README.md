# Mini Browser

## Why?

I want to bunch my many applications such as freshrss into single browser without using desktop version

## Features

- Open link inside browser with external browser
- Isolated persistent cookies

## Add new url

- Create new file `~/.config/mini-browser/apps.json`

```json
[
  {
    "label": "Google",
    "url": "https://google.com",
    "partition": "persist:google"
  },
  {
    "label": "Facebook",
    "url": "https://facebook.com",
    "partition": "persist:facebook"
  }
]
```
