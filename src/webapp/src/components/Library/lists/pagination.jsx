import { useTranslation } from 'react-i18next';

import {
  FormControl,
  InputLabel,
  NativeSelect,
  Pagination,
  Stack,
} from '@mui/material';

import { LIBRARY_PAGE_SIZES } from './page-size';

/*
 * The page-size choice belongs to the current device; the pagination itself
 * only moves through the entries that were loaded for the library view.
 */
const LibraryPagination = ({
  onPageChange,
  onPageSizeChange,
  page,
  pageCount,
  pageSize,
}) => {
  const { t } = useTranslation();

  return (
    <Stack
      direction={{ sm: 'row', xs: 'column' }}
      spacing={2}
      sx={{
        alignItems: { sm: 'center' },
        justifyContent: 'space-between',
        paddingBottom: 'var(--space-2)',
        width: '100%',
      }}
    >
      <FormControl sx={{ minWidth: 180 }}>
        <InputLabel htmlFor="library-page-size" shrink>
          {t('library.pagination.page-size')}
        </InputLabel>
        <NativeSelect
          inputProps={{ id: 'library-page-size' }}
          onChange={(event) => onPageSizeChange(Number(event.target.value))}
          sx={{ '& select': { height: 'var(--touch-min)' } }}
          value={pageSize}
        >
          {LIBRARY_PAGE_SIZES.map((size) => (
            <option key={size} value={size}>{size}</option>
          ))}
        </NativeSelect>
      </FormControl>
      {pageCount > 1 &&
        <Pagination
          aria-label={t('library.pagination.pages')}
          count={pageCount}
          onChange={(_event, value) => onPageChange(value)}
          page={page}
          sx={{
            '& .MuiPaginationItem-root': {
              minHeight: 'var(--touch-min)',
              minWidth: 'var(--touch-min)',
            },
          }}
        />
      }
    </Stack>
  );
};

export default LibraryPagination;
