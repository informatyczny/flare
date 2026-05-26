from nostr_sdk import Client, EventBuilder, Kind, NostrSigner, RelayUrl, Tag

from config import settings
from nostr.keypairs import get_keys


def build_nip52_event(
    facebook_id: str,
    title: str,
    start: int,
    end: int | None,
    description: str | None,
    location: str | None,
    cover_url: str | None,
    source_url: str,
    city: str | None,
) -> EventBuilder:
    tags: list[Tag] = [
        Tag.parse(["d", facebook_id]),
        Tag.parse(["title", title]),
        Tag.parse(["start", str(start)]),
    ]
    if end is not None:
        tags.append(Tag.parse(["end", str(end)]))
    if location:
        tags.append(Tag.parse(["location", location]))
    if cover_url:
        tags.append(Tag.parse(["image", cover_url]))
    if city:
        tags.append(Tag.parse(["l", city, "city"]))
    tags.append(Tag.parse(["r", source_url]))

    return EventBuilder(Kind(31923), description or "").tags(tags)


async def publish_event(
    facebook_id: str,
    title: str,
    start: int,
    end: int | None,
    description: str | None,
    location: str | None,
    cover_url: str | None,
    source_url: str,
    city: str | None,
) -> str:
    keys = get_keys()
    builder = build_nip52_event(
        facebook_id,
        title,
        start,
        end,
        description,
        location,
        cover_url,
        source_url,
        city,
    )

    signer = NostrSigner.keys(keys)
    client = Client(signer)

    for relay_url in settings.NOSTR_RELAYS:
        await client.add_relay(RelayUrl.parse(relay_url))

    await client.connect()
    output = await client.send_event_builder(builder)
    await client.disconnect()

    return output.id.to_hex()
