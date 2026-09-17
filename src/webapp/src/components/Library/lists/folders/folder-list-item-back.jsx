import { useTranslation } from 'react-i18next';

import {
  ListItem,
  ListItemButton,
  ListItemText,
} from '@mui/material';

import ArrowBackIcon from '@mui/icons-material/ArrowBack';

import FolderLink from './folder-link';

import { LIBRARY_ROW_SX } from '../list-layout';

const FolderListItemBack = ({ dir }) => {
  const { t } = useTranslation();

  return (
    <ListItem disablePadding>
      <ListItemButton
        component={FolderLink}
        data={{ dir }}
        aria-label={t('library.folders.back-button-label')}
        nativeButton={false}
        sx={LIBRARY_ROW_SX}
      >
        <ArrowBackIcon />
        <ListItemText primary={'..'} />
      </ListItemButton>
    </ListItem>
  );
}

export default FolderListItemBack;
