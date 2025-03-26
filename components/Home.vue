<script lang="ts" setup>
import { onMounted, ref, toRaw } from 'vue'
import type { FormInst, FormItemRule } from 'naive-ui'
import {
  NAlert,
  NButton,
  NCard,
  NCheckbox,
  NFlex,
  NForm,
  NFormItem,
  NImage,
  NInput,
  NSelect,
  createDiscreteApi,
} from 'naive-ui'
import * as cheerio from 'cheerio'
import { Md5 } from 'ts-md5'
import { isValidHttpUrl } from '@/util/verifyRules'
import { STip } from '@/components'
import { postRequest } from '@/util/request'
import { supportedSunPanelVersion } from '@/util/versionComparison'
import { removeTrailingSlash } from '@/util/cmn'
import { getSunPanelVersion } from '@/api'

defineProps({
  msg: String,
})
const { t } = useI18n()

interface OpenAPIConfig {
  host: string
  token: string
}

interface ImageListItem {
  iconUrl: string
  checked: boolean
}

interface ItemGroupListItem {
  onlyName: string
  title: string
  itemGroupID: number
}

interface ListResp<T> {
  list: T
  count: number
}

interface RecentGroup {
  groupID: number
  groupName: string
}

interface ItemResp {
  title: string
  url: string
  lanUrl: string
  iconUrl: string
  description: string
  isSaveIcon: boolean
  onlyName: string
  itemGroupID: number
  itemGroupOnlyName: string
}

const formRef = ref<FormInst | null>(null)
const ms = createDiscreteApi(['message'])
const currentUrl = ref('')
const webSiteIcons = ref<ImageListItem[]>([])
const isSubmitLoading = ref(false)
const isDeleteLoading = ref(false)
const isSaveSuccess = ref(false)
const itemGroupList = ref<ItemGroupListItem[]>([])
const recentGroups = ref<RecentGroup[]>([])
const sunPanelVersion = ref('')
const openApiConfig = ref<OpenAPIConfig>({
  host: '',
  token: '',
})
const existedItem = ref<ItemResp | null>(null)
const formValue = ref({
  title: '',
  url: '',
  lanUrl: '',
  iconUrl: '',
  description: '',
  itemGroupID: 0,
  isSaveIcon: true,
  onlyName: '',
})

const rules = {
  url: [
    {
      required: true,
      message: t('form.required'),
      trigger: ['blur'],
    },
    {
      trigger: ['blur'],
      message: t('form.httpUrlIncorrect'),
      validator(rule: FormItemRule, value: string) {
        return isValidHttpUrl(value)
      },
    },
  ],

  title: [
    {
      required: true,
      message: t('form.required'),
      trigger: ['blur'],
    },
    {
      max: 20,
      message: t('form.maxLimit', { length: 20 }),
      trigger: ['input', 'blur'],
    },
  ],

  iconUrl: {
    required: true,
    message: t('form.required'),
    trigger: ['input', 'blur'],
  },

  lanUrl: {
    message: t('form.httpUrlIncorrect'),
    trigger: ['input', 'blur'],
    validator(rule: FormItemRule, value: string) {
      return value === '' || isValidHttpUrl(value)
    },
  },
}

function handleSetting() {
  browser.tabs.create({ url: 'settings.html' })
}

async function getUrl() {
  // browser.tabs.query
  // currentUrl.value = window.location.href;
  await browser.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
    const currentTab = tabs[0]
    currentUrl.value = currentTab.url || ''
    let title = currentTab.title || ''
    title = title.replace('——', '—')
    let match = title.match(/[-_–|—]/)
    if (match == null)
      match = title.match(/ /)
    if (match && match.index !== undefined) {
      formValue.value.title = title.substring(0, match.index).trim()
      formValue.value.description = title.substring(match.index + 1).trim()
    }
    else {
      formValue.value.title = title
    }
    // console.log(`当前页面地址是：${currentUrl.value}`)
    const url = `${removeTrailingSlash(openApiConfig.value.host)}/item/getInfoByOnlyName`
    postRequest<ItemResp>({
      url,
      headers: { token: openApiConfig.value.token },
      data: {
        onlyName: Md5.hashStr(currentUrl.value),
      },
    }).then(({ data }) => {
      existedItem.value = data
      formValue.value.title = existedItem.value.title
      formValue.value.iconUrl = existedItem.value.iconUrl
      formValue.value.onlyName = existedItem.value.onlyName
      formValue.value.url = existedItem.value.url
      formValue.value.lanUrl = existedItem.value.lanUrl
      formValue.value.description = existedItem.value.description
      formValue.value.itemGroupID = existedItem.value.itemGroupID
    }).catch((res) => {
      if (res.code === 1203) {
        return
      }
      if (res.code === 1000) {
        ms.message.error(t('popup.tokenInvalid'))
        return
      }
      ms.message.error(`${t('popup.tokenInvalid')}-2000`)
    })
  })
}

async function getItemGroupList() {
  recentGroups.value = await storage.getItem<RecentGroup[]>('local:recentGroups') || []
  const url = `${removeTrailingSlash(openApiConfig.value.host)}/itemGroup/getList`
  await postRequest<ListResp<ItemGroupListItem[]>>({
    url,
    headers: { token: openApiConfig.value.token },
    data: {},
  }).then(({ data }) => {
    itemGroupList.value = data.list
    if (data.list.length > 0) {
      formValue.value.itemGroupID = data.list[0].itemGroupID
    }
    if (recentGroups.value && recentGroups.value && recentGroups.value.length > 0) {
      formValue.value.itemGroupID = recentGroups.value[recentGroups.value.length - 1].groupID
    }
  }).catch((res) => {
    if (res.code === 1000) {
      ms.message.error(t('popup.tokenInvalid'))
      return
    }
    ms.message.error(`${t('popup.tokenInvalid')}-2000`)
  })
}

function isSquareAspect(width: number, height: number, threshold: number = 0.1): boolean {
  const ratio = width / height
  return Math.abs(1 - ratio) <= threshold // 允许±10%误差
}

async function getImageDimensions(url: string) {
  const img = new Image()
  img.src = url
  await img.decode() // 等待图片加载
  return { width: img.naturalWidth, height: img.naturalHeight }
}

async function filterSquareImages(fullUrls: string[]) {
  const squareUrls: string[] = []
  for (const url of fullUrls) {
    try {
      const { width, height } = await getImageDimensions(url)
      if (isSquareAspect(width, height, 0.5)) {
        squareUrls.push(url)
      }
    }
    catch (error) {
      console.error(`Failed  to load image: ${url}`, error)
    }
  }
  return squareUrls
}

async function getSquareImgLinks(html: string) {
  const $ = cheerio.load(html)
  const imgElements = $('img')
  const imgUrls = imgElements.map((i, el) => $(el).attr('src') || $(el).attr('data-src')).get()
  const fullUrls = imgUrls.map(url => parseFullUrl(url, currentUrl.value))
  return filterSquareImages(fullUrls)
}

function getIcoLinks(html: string): string[] {
  const $ = cheerio.load(html)
  const icoTags = $('link[rel="shortcut icon"], link[rel="icon"]')
  const links: string[] = []

  icoTags.each((index, element) => {
    const tag = $(element)
    const href = tag.attr('href')

    if (href) {
      // 检查是否重复
      if (links.includes(href))
        return

      // console.log(href)
      links.push(href)
    }
  })

  return links
}

async function fetchWebsiteSource(url: string) {
  try {
    const response = await fetch(url)
    const html = await response.text()
    // console.log(html)
    return html
  }
  catch (error) {
    console.error('Error fetching website source:', error)
    return null
  }
}

function parseFullUrl(url: string, baseUrl: string): string {
  const urlObj = new URL(url, baseUrl)

  // 判断是否是绝对地址
  if (urlObj.protocol === 'http:' || urlObj.protocol === 'https:') {
    return urlObj.toString()
  }

  // 如果不是绝对地址，则使用基地址进行解析拼接
  return baseUrl + url
}

async function getIconAndUrl(html: string) {
  await getUrl()
  webSiteIcons.value = []
  // currentUrl.value = 'http://192.168.3.41/cgi-bin/luci/'
  formValue.value.url = currentUrl.value
  // const html = await fetchWebsiteSource(currentUrl.value)
  if (html) {
    const icons = getIcoLinks(html || '')

    for (let i = 0; i < icons.length; i++) {
      const element = icons[i]
      const iconUrl = parseFullUrl(element, currentUrl.value)
      webSiteIcons.value.push({ iconUrl, checked: i === 0 })
      if (i === 0) {
        formValue.value.iconUrl = iconUrl
      }
      // console.log(iconUrl)
    }

    if (icons.length === 0) {
      const urlObj = new URL(currentUrl.value, currentUrl.value)
      // 没有找到图标使用默认图标
      const iconUrl = `${urlObj.protocol}//${urlObj.host}/favicon.ico`
      webSiteIcons.value.push({ iconUrl, checked: true })
      formValue.value.iconUrl = iconUrl
    }

    const imgLinks = await getSquareImgLinks(html || '')
    console.log(imgLinks)
    for (let i = 0; i < imgLinks.length; i++) {
      webSiteIcons.value.push({ iconUrl: imgLinks[i], checked: i === 0 && formValue.value.iconUrl != null })
      if (i === 0 && formValue.value.iconUrl != null) {
        formValue.value.iconUrl = imgLinks[i]
      }
    }
  }
}

function handleSelectIcon(icon: ImageListItem) {
  formValue.value.iconUrl = icon.iconUrl
  for (let i = 0; i < webSiteIcons.value.length; i++) {
    const element = webSiteIcons.value[i]
    webSiteIcons.value[i].checked = element.iconUrl === icon.iconUrl
  }
}

async function changeGroup(groupID: number) {
  formValue.value.itemGroupID = groupID
}

async function submit() {
  // 没有找到图标使用默认图标
  const url = `${removeTrailingSlash(openApiConfig.value.host)}/item/${existedItem.value == null ? 'create' : 'update'}`
  isSubmitLoading.value = true
  // TODO 需要一个图像转换服务, 例如ico转换为png, 最佳方案是全部转换为png
  // 唯一名称
  formValue.value.onlyName = Md5.hashStr(formValue.value.url)
  await postRequest({
    url,
    headers: { token: openApiConfig.value.token },
    data: formValue.value,
  }).then(() => {
    ms.message.success(t('common.saveSuccess'))
    isSaveSuccess.value = true // 保存成功禁止再次保存
  }).catch((res) => {
    if (res.code === 1000) {
      ms.message.error(t('popup.tokenInvalid'))
      return
    }
    ms.message.error(`${t('popup.tokenInvalid')}-2000`)
  })
  if (recentGroups.value.map(group => group.groupID).includes(formValue.value.itemGroupID))
    return
  const targetItemGroup = itemGroupList.value.find(group => group.itemGroupID === formValue.value.itemGroupID)
  if (targetItemGroup) {
    recentGroups.value.push({ groupID: targetItemGroup.itemGroupID, groupName: targetItemGroup.title })
    if (recentGroups.value.length > 4)
      recentGroups.value.shift()
    await storage.setItem<RecentGroup[]>('local:recentGroups', toRaw(recentGroups.value))
  }
  isSubmitLoading.value = false
}

function handleDelete(e: MouseEvent) {
  e.preventDefault()
  isDeleteLoading.value = true

  // TODO 服务端没有删除接口
  ms.message.error(t('暂不支持'))

  isDeleteLoading.value = false
}

function handleSave(e: MouseEvent) {
  e.preventDefault()
  formRef.value?.validate((errors) => {
    if (!errors) {
      submit()
    }
    else {
      console.error(errors)
      ms.message.error(t('form.error'))
    }
  })
}

onMounted(async () => {
  await storage.getItem<OpenAPIConfig>('local:openAPIConfig').then((cfg) => {
    if (cfg) {
      openApiConfig.value = cfg as OpenAPIConfig
    }
  })

  if (openApiConfig.value.host === '' || openApiConfig.value.token === '')
    return

  getSunPanelVersion<SunPanelVersion.Info>().then(({ data }) => {
    sunPanelVersion.value = data.version
    if (supportedSunPanelVersion('1.7.0', data.version)) {
      getItemGroupList()
    }
  })

  browser.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
    browser.tabs.sendMessage(tabs[0].id || 0, { action: 'requestSource' }).then((response) => {
      if (response.action === 'responseSource') {
        // console.log(' 源码内容:', response.source)
        getIconAndUrl(response.source)
      }
    })
  })
})

function handle_message() {
  // browser.runtime.onMessage.addListener((request, sender) => {
  //   if (request.action === "responseSource") {
  //     console.log(" 源码内容:", request.source)
  //     getIconAndUrl(request.source)
  //   }
  // })
  //
  // browser.runtime.sendMessage({action: "requestSource"})

  browser.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
    browser.tabs.sendMessage(tabs[0].id || 0, { action: 'requestSource' }).then((response) => {
      if (response.action === 'responseSource') {
        console.log(' 源码内容:', response.source)
        getIconAndUrl(response.source)
      }
    })
  })
}
</script>

<template>
  <div class="my-2 text-lg font-bold text-zinc-700">
    <div class="flex items-center">
      <div>
        {{ t('popup.addCurrentSiteToSunPanel') }}
      </div>

      <STip class="mx-2 flex items-center">
        <div class="max-w-[200px]">
          {{ t('popup.functionDescription') }}
        </div>
      </STip>

      <NButton size="small" type="error" round secondary @click="handle_message">
        {{ t('common.debug') }}
      </NButton>

      <!-- <NButton size="tiny" type="info" ghost circle @click="getIconAndUrl">
        <template #icon>
          <RefreshIcon />
        </template>
      </NButton> -->
    </div>
  </div>

  <NAlert v-if="openApiConfig.host === '' || openApiConfig.token === ''" type="error" class="my-2" size="small">
    {{ t('popup.noSetOpenAPIUrl') }}
    <div class="text-[blue] cursor-pointer" @click="handleSetting">
      {{ t('popup.goSet') }}
    </div>
  </NAlert>

  <NAlert
    v-if="existedItem != null" type="warning"
    :title="`${t('common.existed_start')}  ${itemGroupList.find(group => group.itemGroupID === existedItem?.itemGroupID)?.title} ${t('common.existed_end')}`"
  />

  <NCard style="border-radius: 1rem;margin-bottom: 20px;" size="small" embedded>
    <NForm
      ref="formRef" :label-width="80" :model="formValue" :rules="rules" size="small"
      label-placement="left" require-mark-placement="left"
    >
      <NFormItem path="itemGroupID">
        <template #label>
          <NFlex>
            {{ t('popup.itemGroup') }}
            <STip
              v-if="sunPanelVersion === '' || !supportedSunPanelVersion('1.7.0', sunPanelVersion)"
              class="flex items-center text-sm text-orange-600"
            >
              <div class="max-w-[200px]">
                ({{ t('common.unSupportSunPanelVersionWarning', { version: "v1.7.0" }) }})
                <br>
                {{ t('popup.unSupportSunPanelVersionGroupWarning', { version: "v1.7.0" }) }}
              </div>
            </STip>
          </NFlex>
        </template>
        <NSelect
          v-model:value="formValue.itemGroupID"
          :disabled="sunPanelVersion === '' || !supportedSunPanelVersion('1.7.0', sunPanelVersion)"
          :options="itemGroupList" label-field="title" value-field="itemGroupID"
        />
      </NFormItem>

      <NFormItem v-if="recentGroups.length > 1" path="recentGroups">
        <NFlex>
          <template v-for="(group, index) in recentGroups" :key="index">
            <NButton
              v-if="group.groupID !== formValue.itemGroupID" strong secondary round type="primary"
              @click="changeGroup(group.groupID)"
            >
              {{ group.groupName }}
            </NButton>
          </template>
        </NFlex>
      </NFormItem>

      <NFormItem path="iconUrl">
        <template #label>
          <div class="flex items-center">
            {{ t('popup.iconObtained') }}
          </div>
        </template>
        <div>
          <div>
            <NImage
              v-for="(icon, index) in webSiteIcons" :key="index" preview-disabled :src="icon.iconUrl"
              class="cursor-pointer"
              style="width: 50px;height: 50px;border-radius: 5px;margin-right: 10px;padding:2px;box-shadow: 0 0 5px gray;"
              :style="icon.checked ? 'border:2px #4EB4BC solid;' : 'border:1px #C1C6CC solid;'"
              @click="handleSelectIcon(icon)"
            />
          </div>
          <div class="mt-2">
            <NCheckbox
              v-model:checked="formValue.isSaveIcon"
              :disabled="sunPanelVersion === '' || !supportedSunPanelVersion('1.7.0', sunPanelVersion)"
            >
              <NFlex :gap="2">
                {{ t('popup.saveIcon') }}
                <STip class="flex items-center text-sm ">
                  <div class="max-w-[200px]">
                    {{ t('popup.saveIconFileText', { version: "v1.7.0" }) }}
                  </div>
                </STip>

                <STip
                  v-if="sunPanelVersion === '' || !supportedSunPanelVersion('1.7.0', sunPanelVersion)"
                  class="flex items-center text-sm text-orange-600"
                >
                  <div class="max-w-[200px]">
                    ({{ t('common.unSupportSunPanelVersionWarning', { version: "v1.7.0" }) }})
                    <br>
                    {{ t('popup.unSupportSunPanelVersionSaveIconWarning', { version: "v1.7.0" }) }}
                  </div>
                </STip>
              </NFlex>
            </NCheckbox>
          </div>
        </div>
      </NFormItem>

      <NFormItem :label="t('common.title')" path="title">
        <NInput
          v-model:value="formValue.title" size="small"
          :disabled="openApiConfig.host === '' || openApiConfig.token === ''"
        />
      </NFormItem>

      <NFormItem :label="t('common.description')" path="description">
        <NInput
          v-model:value="formValue.description"
          :disabled="openApiConfig.host === '' || openApiConfig.token === ''"
        />
      </NFormItem>

      <NFormItem :label="t('common.defaultAddress')" path="url">
        <NInput
          v-model:value="formValue.url"
          :disabled="openApiConfig.host === '' || openApiConfig.token === '' || existedItem != null"
        />
      </NFormItem>

      <NFormItem :label="t('popup.lanAddress')" path="lanUrl">
        <NInput
          v-model:value="formValue.lanUrl"
          :disabled="openApiConfig.host === '' || openApiConfig.token === '' || existedItem != null"
        />
      </NFormItem>

      <NFlex v-if="existedItem != null" justify="center">
        <NButton
          size="medium" type="warning" style="width: 48%;"
          :disabled="isSaveSuccess || openApiConfig.host === '' || openApiConfig.token === ''"
          :loading="isSubmitLoading"
          @click="handleSave"
        >
          {{ t('common.update') }}
        </NButton>

        <NButton
          size="medium" type="error" style="width: 48%;"
          :disabled="isSaveSuccess || openApiConfig.host === '' || openApiConfig.token === ''"
          :loading="isDeleteLoading"
          @click="handleDelete"
        >
          {{ t('common.delete') }}
        </NButton>
      </NFlex>
      <NFlex v-else justify="center">
        <NButton
          size="medium" type="success" style="width: 100%;"
          :disabled="isSaveSuccess || openApiConfig.host === '' || openApiConfig.token === ''"
          :loading="isSubmitLoading"
          @click="handleSave"
        >
          {{ t('common.save') }}
        </NButton>
      </NFlex>
    </NForm>
  </NCard>

  <!-- <div>{{ currentUrl }}</div> -->
</template>
