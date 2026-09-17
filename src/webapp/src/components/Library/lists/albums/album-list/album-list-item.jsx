import { forwardRef, useContext, useEffect, useState } from 'react';
import {
  Link,
  useLocation,
} from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import {
  Avatar,
  ListItem,
  ListItemAvatar,
  ListItemButton,
  ListItemText,
} from '@mui/material';

import noCover from '../../../../../assets/noCover.jpg';

import {
  LIBRARY_AVATAR_SX,
  LIBRARY_PRIMARY_SX,
  LIBRARY_ROW_SX,
  LIBRARY_SECONDARY_SX,
} from '../../list-layout';

import AppSettingsContext from '../../../../../context/appsettings/context';
import request from '../../../../../utils/request';

const AlbumListItem = ({
  albumartist,
  album,
  content_uri,
  cover_url,
  isButton = true,
  provider = 'mpd',
  view = 'albums',
}) => {
  const { t } = useTranslation();
  const { search: urlSearch } = useLocation();
  const [coverImage, setCoverImage] = useState(cover_url || noCover);

  const {
    settings,
  } = useContext(AppSettingsContext);

  const {
    show_covers,
  } = settings;

  useEffect(() => {
    const getCoverArt = async () => {
      const { result } = await request('getAlbumCoverArt', {
        albumartist,
        album,
        content_uri,
        provider,
      });
      if (result) {
        if(result !== 'CACHE_PENDING') {
          setCoverImage(result.startsWith('http') ? result : `/cover-cache/${result}`);
        }
      };
    }

    setCoverImage(cover_url || noCover);
    if (cover_url) {
      setCoverImage(cover_url);
    }
    else if (albumartist && album && show_covers) {
      getCoverArt();
    }
  }, [albumartist, album, content_uri, cover_url, provider, show_covers]);

  const AlbumLink = forwardRef((props, ref) => {
    const artist = encodeURIComponent(albumartist || t('library.albums.unknown-artist'));
    const encodedAlbum = encodeURIComponent(album || t('library.albums.unknown-album'));

    const searchParams = new URLSearchParams(urlSearch);
    if (content_uri) searchParams.set('content_uri', content_uri);
    else searchParams.delete('content_uri');
    const search = searchParams.toString();
    const location = [
      `/library/${provider}/${view}/${artist}/${encodedAlbum}`,
      search ? `?${search}` : '',
    ].join('');

    return <Link ref={ref} to={location} {...props} />
  });
  AlbumLink.displayName = 'AlbumLink';

  const content = (
    <>
      {show_covers &&
        <ListItemAvatar sx={{ minWidth: 104 }}>
          <Avatar
            alt="Cover"
            src={coverImage}
            sx={LIBRARY_AVATAR_SX}
            variant="rounded"
          />
        </ListItemAvatar>
      }
      <ListItemText
        primary={album || t('library.albums.unknown-album')}
        secondary={albumartist || null}
        slotProps={{
          primary: { sx: LIBRARY_PRIMARY_SX },
          secondary: { sx: LIBRARY_SECONDARY_SX },
        }}
      />
    </>
  );

  return (
    <ListItem disablePadding={isButton} key={content_uri || album}>
      {isButton
        ? (
          <ListItemButton component={AlbumLink} nativeButton={false} sx={LIBRARY_ROW_SX}>
            {content}
          </ListItemButton>
        )
        : content
      }
    </ListItem>
  );
}

export default AlbumListItem;
