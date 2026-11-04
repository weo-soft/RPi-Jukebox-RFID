import { useContext } from 'react';
import { useTranslation } from 'react-i18next';

import {
  FormControl,
  Grid,
  NativeSelect,
  Typography,
} from '@mui/material';

import AppSettingsContext from '../../../context/appsettings/context';
import request from '../../../utils/request';
import {
  LIBRARY_PAGE_SIZES,
  resolveLibraryPageSize,
} from '../../Library/lists/page-size';

const rowSx = {
  alignItems: 'center',
  justifyContent: 'space-between',
};

const LibraryPageSize = () => {
  const { t } = useTranslation();

  const {
    setSettings,
    settings,
  } = useContext(AppSettingsContext);

  const pageSize = resolveLibraryPageSize(null, settings?.library_page_size);

  const updatePageSize = async (size) => {
    setSettings(current => ({ ...current, library_page_size: size }));
    await request('setAppSettings', { settings: { library_page_size: size }});
  };

  return (
    <Grid container sx={rowSx}>
      <Grid size={{ md: 8, xs: 12 }}>
        <Typography>
          {t('settings.general.library_page_size.title')}
        </Typography>
        <Typography color="textSecondary" variant="contentBody">
          {t('settings.general.library_page_size.description')}
        </Typography>
      </Grid>
      <Grid
        size={{ md: 4, xs: 12 }}
        sx={{
          display: 'flex',
          justifyContent: { md: 'flex-end', xs: 'flex-start' },
          marginTop: { md: 0, xs: 'var(--space-2)' },
        }}
      >
        <FormControl sx={{ minWidth: 180, width: { md: 'auto', xs: '100%' } }}>
          <NativeSelect
            inputProps={{
              'aria-label': t('settings.general.library_page_size.title'),
              id: 'settings-library-page-size',
            }}
            onChange={(event) => updatePageSize(Number(event.target.value))}
            sx={{ '& select': { height: 'var(--touch-min)' } }}
            value={pageSize}
          >
            {LIBRARY_PAGE_SIZES.map((size) => (
              <option key={size} value={size}>{size}</option>
            ))}
          </NativeSelect>
        </FormControl>
      </Grid>
    </Grid>
  );
};

export default LibraryPageSize;
