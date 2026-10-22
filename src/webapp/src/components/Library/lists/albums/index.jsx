import { useContext, useEffect, useMemo, useState } from "react";
import { useTranslation } from 'react-i18next';

import {
  Typography,
} from "@mui/material";

import { Loading } from '../../../general';
import AppSettingsContext from '../../../../context/appsettings/context';
import request from '../../../../utils/request';
import { flatByAlbum } from '../../../../utils/utils';

import AlbumList from "./album-list";
import LibraryPagination from '../pagination';
import {
  readLibraryPageSize,
  resolveLibraryPageSize,
  writeLibraryPageSize,
} from '../page-size';

const Albums = ({
  contentTypes,
  musicFilter,
  provider,
  view,
}) => {
  const { t } = useTranslation();
  const { settings } = useContext(AppSettingsContext);

  const [albums, setAlbums] = useState([]);
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [localPageSize, setLocalPageSize] = useState(() => readLibraryPageSize());
  const [page, setPage] = useState(1);

  const pageSize = resolveLibraryPageSize(localPageSize, settings?.library_page_size);
  const contentTypesKey = contentTypes?.join(',') || '';

  useEffect(() => {
    let isCurrent = true;
    const fetchAlbumList = async () => {
      setIsLoading(true);
      setError(null);
      const { result, error: requestError } = await request('libraryItems', {
        provider,
        content_types: contentTypesKey ? contentTypesKey.split(',') : undefined,
      });
      if (!isCurrent) return;
      setIsLoading(false);

      if(result) setAlbums(result.reduce(flatByAlbum, []));
      if(requestError) setError(requestError);
    }

    fetchAlbumList();
    return () => {
      isCurrent = false;
    };
  }, [contentTypesKey, provider]);

  const filteredAlbums = useMemo(() => {
    if (musicFilter === '') return albums;

    const query = musicFilter.toLowerCase();
    return albums.filter(({ albumartist, album }) => (
      (albumartist || '').toLowerCase().includes(query)
      || (album || '').toLowerCase().includes(query)
    ));
  }, [albums, musicFilter]);

  const pageCount = Math.max(1, Math.ceil(filteredAlbums.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const visibleAlbums = useMemo(() => (
    filteredAlbums.slice((currentPage - 1) * pageSize, currentPage * pageSize)
  ), [currentPage, filteredAlbums, pageSize]);

  useEffect(() => {
    setPage(1);
  }, [musicFilter, pageSize, provider, view]);

  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  const changePageSize = (size) => {
    writeLibraryPageSize(size);
    setLocalPageSize(size);
    setPage(1);
  };

  return (
    <>
      {isLoading
        ? <Loading />
        : <>
            {filteredAlbums.length > 0 &&
              <LibraryPagination
                onPageChange={setPage}
                onPageSizeChange={changePageSize}
                page={currentPage}
                pageCount={pageCount}
                pageSize={pageSize}
              />
            }
            <AlbumList
              albums={visibleAlbums}
              musicFilter={musicFilter}
              view={view}
            />
          </>}
      {error &&
        <Typography>{t('library.loading-error')}</Typography>
      }
    </>
  );
};

export default Albums;
