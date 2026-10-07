"""
Makes the key pair for notifications when the app is closed (section 38).

Run once per environment, from backend/:
    python scripts/make_vapid_keys.py

It prints VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY; put both in Infisical,
in that environment. Make them once and keep them: a new pair silently
turns off every notification people have already turned on, and with
several servers every one of them must hold the same pair.
"""

import base64

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec


def b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def main() -> None:
    key = ec.generate_private_key(ec.SECP256R1())
    private = key.private_numbers().private_value.to_bytes(32, "big")
    public = key.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    print(f"VAPID_PUBLIC_KEY={b64(public)}")
    print(f"VAPID_PRIVATE_KEY={b64(private)}")


if __name__ == "__main__":
    main()
