# History Swipe

On a touch display a horizontal swipe can navigate the browser history back or
forward. In the kiosk this leaves the running player view unintentionally.

**Settings → General → Prevent history swipe** disables that gesture for the
current device. It is enabled by default in the kiosk and disabled on every
other origin. The choice is stored in `localStorage` under
`preventHistorySwipe`.

When the guard is enabled, the root scroller uses
`overscroll-behavior-x: none`, which prevents the browser's horizontal
overscroll history gesture. It does not disable the normal back/forward
controls or links inside the Web App.
