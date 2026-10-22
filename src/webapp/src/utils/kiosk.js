/*
 * The kiosk is the only client that loads the Web App from the box itself.
 * Its loopback origin on the default port separates it from every desktop
 * that reaches the box through its hostname or address.
 */
const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '::1', '[::1]'];
const DEFAULT_PORTS = ['', '80', '443'];

const isKioskOrigin = ({
  hostname = '',
  port = '',
} = {}) => (
  LOOPBACK_HOSTS.includes(hostname) && DEFAULT_PORTS.includes(port)
);

export { isKioskOrigin };
